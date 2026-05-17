import { Hono } from "hono";

import listRoute from "./list.js";
import detailRoute from "./detail.js";
import createRoute from "./create.js";
import metaRoute from "./meta.js";

import type { AppBindings } from "../../lib/types.js";

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.route("/", listRoute);
tokensRoute.route("/", detailRoute);
tokensRoute.route("/", createRoute);
tokensRoute.route("/", metaRoute);

export default tokensRoute;
