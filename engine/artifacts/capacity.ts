/** Safe saved-state code; never include a SQL/credential/ciphertext error body. */
export class ObjectCapacityError extends Error {
  readonly code = 'OBJECT_CAPACITY_UNAVAILABLE'
  constructor() {
    super('Encrypted source capacity is unavailable. Existing source remains saved.')
  }
}
