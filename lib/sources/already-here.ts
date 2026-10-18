/**
 * The package is already in the catalog.
 *
 * Thrown by every source's add when the package id it is about to file is
 * already carried by a listing, and the caller did not ask for a second one.
 * It carries the listing it is here as, so the panel can offer the second
 * listing instead of only repeating the sentence; the routes answer it with a
 * 409 and the same two fields, which is the offer in wire form.
 *
 * Two listings under one package id are not a duplicate row when they are
 * two builds — the store's own patched client beside a public mod — and each
 * keeps its own page, versions and signing key. The importer tells such
 * siblings apart by the key a drop is signed with.
 */
export class AlreadyHere extends Error {
  constructor(
    readonly existingSlug: string,
    readonly existingName: string,
  ) {
    super(`${existingName} is already in the catalog as "${existingSlug}"`);
  }
}

/** The 409 every add route answers an `AlreadyHere` with. */
export function alreadyHereResponse(err: AlreadyHere): Response {
  return Response.json(
    {
      error: err.message,
      existingSlug: err.existingSlug,
      existingName: err.existingName,
    },
    { status: 409 },
  );
}
