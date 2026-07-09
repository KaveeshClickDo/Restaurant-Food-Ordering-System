/**
 * One-time backfill: populate the marketing-contacts table
 * (marketing_contacts) from every place the live database already holds a
 * customer email — registered customers, orders, reservations, gift cards.
 *
 *   Run with:  npx tsx --env-file=.env.local backfill-marketing-contacts.ts
 *   Dry run:   npx tsx --env-file=.env.local backfill-marketing-contacts.ts --dry-run
 *   (or `npm run db:backfill-contacts [-- --dry-run]`)
 *
 * REQUIRES the marketing-contacts migration in supabase/schema.sql (the
 * `sources` column) — run `npm run db:migrate` first.
 *
 * Idempotent by construction, safe to re-run:
 *   • source stamps are guarded with `not sources @> '{...}'`
 *   • inserts use `on conflict (email) do nothing`
 *   • order counters are only set the FIRST time 'online_order' is stamped
 * Everything runs in one transaction; --dry-run rolls it back and just prints
 * what would have changed.
 *
 * Synthetic addresses (pos-*@internal.local, the walk-in sentinel) and
 * soft-deleted customer accounts are excluded throughout.
 */

import pg from "pg";

const EMAIL_RE = String.raw`^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$`;

interface Step {
  label: string;
  sql: string;
}

const STEPS: Step[] = [
  {
    label: "stamp 'online_order' on existing contacts with order history",
    sql: `
      update marketing_contacts
         set sources = sources || '{online_order}'::text[], updated_at = now()
       where order_count > 0
         and not (sources @> '{online_order}'::text[])`,
  },
  {
    label: "stamp 'reservation' on existing contacts with visit history",
    sql: `
      update marketing_contacts
         set sources = sources || '{reservation}'::text[], updated_at = now()
       where visit_count > 0
         and not (sources @> '{reservation}'::text[])`,
  },
  {
    label: "stamp 'reservation' on existing contacts matching a reservation email",
    sql: `
      update marketing_contacts rc
         set sources = rc.sources || '{reservation}'::text[], updated_at = now()
       where not (rc.sources @> '{reservation}'::text[])
         and exists (select 1 from reservations r
                      where lower(trim(r.customer_email)) = lower(rc.email))`,
  },
  {
    label: "insert contacts for reservation emails with no contact row",
    sql: `
      insert into marketing_contacts
        (id, email, name, phone, sources, visit_count, first_visit_at, last_visit_at, created_at, updated_at)
      select gen_random_uuid()::text,
             lower(trim(r.customer_email)),
             coalesce(max(r.customer_name), ''),
             coalesce(max(nullif(trim(r.customer_phone), '')), ''),
             '{reservation}',
             count(*) filter (where r.status = 'checked_out'),
             min(r.created_at),
             max(r.checked_out_at),
             now(), now()
        from reservations r
       where trim(coalesce(r.customer_email, '')) <> ''
         and lower(trim(r.customer_email)) not like '%@internal.local'
         and trim(r.customer_email) ~ '${EMAIL_RE}'
       group by lower(trim(r.customer_email))
      on conflict (email) do nothing`,
  },
  {
    label: "insert contacts for registered customers ('account' / POS-created 'pos')",
    sql: `
      insert into marketing_contacts
        (id, email, name, phone, sources, customer_id, created_at, updated_at)
      select gen_random_uuid()::text,
             lower(trim(c.email)),
             c.name,
             coalesce(c.phone, ''),
             case when c.id like 'pc-%' then '{pos}'::text[] else '{account}'::text[] end,
             c.id, now(), now()
        from customers c
       where c.deleted_at is null
         and c.id <> 'pos-walk-in'
         and lower(trim(c.email)) not like '%@internal.local'
         and trim(c.email) ~ '${EMAIL_RE}'
      on conflict (email) do nothing`,
  },
  {
    label: "link existing contacts to customer accounts (+source, fill blank name/phone)",
    sql: `
      update marketing_contacts rc
         set customer_id = c.id,
             sources = case
               when rc.sources @> (case when c.id like 'pc-%' then '{pos}' else '{account}' end)::text[]
                 then rc.sources
               else rc.sources || (case when c.id like 'pc-%' then '{pos}' else '{account}' end)::text[]
             end,
             name  = case when rc.name  = '' then c.name               else rc.name  end,
             phone = case when rc.phone = '' then coalesce(c.phone,'') else rc.phone end,
             updated_at = now()
        from customers c
       where lower(trim(c.email)) = lower(rc.email)
         and c.deleted_at is null
         and c.id <> 'pos-walk-in'
         and (rc.customer_id is distinct from c.id
              or not rc.sources @> (case when c.id like 'pc-%' then '{pos}' else '{account}' end)::text[]
              or (rc.name  = '' and c.name <> '')
              or (rc.phone = '' and coalesce(c.phone,'') <> ''))`,
  },
  {
    label: "aggregate order history onto newly-linked contacts (+'online_order')",
    sql: `
      update marketing_contacts rc
         set order_count   = s.cnt,
             total_spend   = round(s.spend::numeric, 2),
             last_order_at = s.last_at,
             sources       = rc.sources || '{online_order}'::text[],
             updated_at    = now()
        from (select o.customer_id,
                     count(*)::int          as cnt,
                     coalesce(sum(o.total), 0) as spend,
                     max(o.date)            as last_at
                from orders o
               where o.customer_id is not null
                 and o.customer_id not in ('guest', 'pos-walk-in')
                 and coalesce(o.status, '') <> 'cancelled'
                 and o.voided_by is null
               group by o.customer_id) s
       where rc.customer_id = s.customer_id
         and not (rc.sources @> '{online_order}'::text[])`,
  },
  {
    label: "insert contacts for gift card recipients",
    sql: `
      insert into marketing_contacts (id, email, name, sources, created_at, updated_at)
      select gen_random_uuid()::text,
             lower(trim(g.issued_to_email)),
             coalesce(max(nullif(trim(g.issued_to_name), '')), ''),
             '{gift_card}', now(), now()
        from gift_cards g
       where trim(coalesce(g.issued_to_email, '')) <> ''
         and lower(trim(g.issued_to_email)) not like '%@internal.local'
         and trim(g.issued_to_email) ~ '${EMAIL_RE}'
       group by lower(trim(g.issued_to_email))
      on conflict (email) do nothing`,
  },
  {
    label: "stamp 'gift_card' on existing contacts who received a card",
    sql: `
      update marketing_contacts rc
         set sources = rc.sources || '{gift_card}'::text[], updated_at = now()
       where not (rc.sources @> '{gift_card}'::text[])
         and exists (select 1 from gift_cards g
                      where lower(trim(g.issued_to_email)) = lower(rc.email))`,
  },
  {
    label: "stamp 'gift_card' on contacts who BOUGHT a card while signed in",
    sql: `
      update marketing_contacts rc
         set sources = rc.sources || '{gift_card}'::text[], updated_at = now()
        from gift_cards g
        join customers c on c.id = g.issued_by_customer_id
       where lower(trim(c.email)) = lower(rc.email)
         and not (rc.sources @> '{gift_card}'::text[])`,
  },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("✗ DATABASE_URL is not set. Add it to app/.env.local.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Guard: the migration must have been applied first.
    const col = await client.query(
      `select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'marketing_contacts'
          and column_name  = 'sources'`,
    );
    if (col.rowCount === 0) {
      console.error("✗ marketing_contacts.sources does not exist — run `npm run db:migrate` first.");
      process.exit(1);
    }

    await client.query("begin");

    for (const step of STEPS) {
      const res = await client.query(step.sql);
      console.log(`${(res.rowCount ?? 0).toString().padStart(6)}  ${step.label}`);
    }

    const { rows } = await client.query(
      `select unnest(sources) as source, count(*)::int as contacts
         from marketing_contacts group by 1 order by 2 desc`,
    );
    const total = await client.query(`select count(*)::int as n from marketing_contacts`);

    console.log(`\nContacts total: ${total.rows[0].n}`);
    for (const r of rows) console.log(`  ${String(r.source).padEnd(14)} ${r.contacts}`);

    if (dryRun) {
      await client.query("rollback");
      console.log("\n⏭  DRY RUN — all changes rolled back.");
    } else {
      await client.query("commit");
      console.log("\n✓ backfill committed.");
    }
  } catch (err) {
    try { await client.query("rollback"); } catch { /* not in a txn */ }
    console.error("✗ backfill failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
