import "server-only";
import { realServer } from "./real";
import { stubServer } from "./stub";
import type { GameServer } from "./types";

// Stub until the backend exists: set LOTUS_USE_STUB=0 together with DATABASE_URL to use @lotus/server.
export const game: GameServer = process.env.LOTUS_USE_STUB === "0" ? realServer : stubServer;
