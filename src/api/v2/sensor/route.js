import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/maxdata/:type/:start/:end", controller.maxdata);

export default router;
