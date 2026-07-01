import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Validates a proposed parent_id for a category. Enforces the two-level model
 * the admin UI assumes, server-side, so the hierarchy can't be corrupted via
 * direct API calls:
 *   - a category cannot be its own parent
 *   - the parent must exist
 *   - the parent must itself be top-level (no nesting → also prevents cycles)
 *   - a category that already has children cannot become a sub-category
 *
 * Returns an error message string when invalid, or null when the parent is OK
 * (including the null/top-level case, which is always allowed).
 */
export async function validateCategoryParent(
  categoryId: string,
  parentId: string | null | undefined,
): Promise<string | null> {
  if (!parentId) return null; // staying / becoming top-level is always fine

  if (parentId === categoryId) {
    return "A category cannot be its own parent.";
  }

  // Parent must exist and be top-level (single-level nesting only).
  const { data: parent, error } = await supabaseAdmin
    .from("categories")
    .select("id, parent_id")
    .eq("id", parentId)
    .maybeSingle();
  if (error) return error.message;
  if (!parent) return "Parent category not found.";
  if (parent.parent_id) {
    return "Cannot nest under a sub-category. Choose a top-level parent.";
  }

  // A category that already has its own children can't become a sub-category.
  const childCount = await countCategoryChildren(categoryId);
  if (childCount > 0) {
    return "This category has sub-categories. Move them to another parent before converting it to a sub-category.";
  }

  return null;
}

/** Number of direct children (sub-categories) of a category. */
export async function countCategoryChildren(categoryId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", categoryId);
  return count ?? 0;
}

/** Number of menu items directly assigned to a category. */
export async function countCategoryItems(categoryId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("menu_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  return count ?? 0;
}
