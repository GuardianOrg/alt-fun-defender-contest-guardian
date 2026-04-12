import { Hono } from "hono";

import listRoute from "./list.js";
import detailRoute from "./detail.js";
import createRoute from "./create.js";

import type { AppBindings } from "../../lib/types.js";

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.route("/", listRoute);
tokensRoute.route("/", detailRoute);
tokensRoute.route("/", createRoute);

export default tokensRoute;
