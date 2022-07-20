import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/last/:start/:end", controller.last);
router.get("/messages/:start/:end", controller.messages);
router.get("/history/:start/:end", controller.history);
router.get("/csv/:start/:end", controller.csv);
router.get("/count/:sender", controller.countTxBySender);
router.get("/count", controller.countTxAll);
router.get("/all", controller.all);
router.get("/all/:type", controller.allByType);
router.get("/:sensor/:start/:end", controller.sensor);

export default router;
