import { db } from "ponder:api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { graphql } from "ponder";
import * as schema from "../../ponder.schema";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
