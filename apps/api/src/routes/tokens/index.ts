import { Hono } from "hono";

import listRoute from "./list.js";
import detailRoute from "./detail.js";
import createRoute from "./create.js";
import metaRoute from "./meta.js";
import validRoute from "./valid.js";

import type { AppBindings } from "../../lib/types.js";

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.route("/", listRoute);
tokensRoute.route("/", detailRoute);
tokensRoute.route("/", createRoute);
tokensRoute.route("/", metaRoute);
tokensRoute.route("/", validRoute);

export default tokensRoute;
