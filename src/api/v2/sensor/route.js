import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/maxdata/:type/:start/:end", controller.maxdata);
router.get("/list/:start/:end", controller.list);
router.get("/messages/:start/:end", controller.messages);

export default router;
