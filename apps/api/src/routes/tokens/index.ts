import { Hono } from "hono";

import listRoute from "./list.js";
import detailRoute from "./detail.js";
import createRoute from "./create.js";
import earningsRoute from "./earnings.js";

import type { AppBindings } from "../../lib/types.js";

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.route("/", listRoute);
tokensRoute.route("/", detailRoute);
tokensRoute.route("/", createRoute);
tokensRoute.route("/", earningsRoute);

export default tokensRoute;
