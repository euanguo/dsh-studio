/** Shared route-table types for the split namespace handler modules. */
/** One API method dispatch table entry. */
export type ApiMethod = (payload: unknown) => Promise<unknown> | unknown