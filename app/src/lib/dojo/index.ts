/**
 * Server-side entry point for the Dojo card-terminal integration. SERVER-SIDE
 * ONLY: routes import from here. The client bundle uses ./posApi and ./types.
 *
 * mock ↔ sandbox ↔ live is purely a config change (DOJO_MODE); see ./select.
 */

export type { DojoGateway } from "./gateway";
export { getDojoGateway } from "./select";
export { DojoApiError, DojoDisabledError } from "./errors";
export { isDojoEnabled, dojoMode, dojoConfig, isDojoSandboxKey } from "./config";
export { isDojoEffectivelyEnabled, getDojoAdminEnabled } from "./effectiveFlag";
export { recordDojoPayment, type DojoSource, type DojoResultInput } from "./recordPayment";
export { resolveSnapshot } from "./gateway";
