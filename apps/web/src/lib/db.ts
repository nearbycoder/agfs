import { drizzle } from "drizzle-orm/d1";
import * as schema from "@agfs/db";
import { requireResourceBindings } from "./bindings";

export const db = drizzle(requireResourceBindings("DB").DB, { schema });
