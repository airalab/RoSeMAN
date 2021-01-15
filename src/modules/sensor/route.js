import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/history/:start/:end", controller.history);
router.get("/csv/:start/:end", controller.csv);
router.get("/count/:sender", controller.countTxBySender);
router.get("/count", controller.countTxAll);
router.get("/all", controller.all);
router.get("/all/:type", controller.allByType);
router.get("/:sensor", controller.sensor);

export default router;
