// Launch cities live in the server package (single source of truth); this module has no imports so it's client-safe.
export { SERVICE_CITIES, type ServiceCity } from "../../server/src/cities";
