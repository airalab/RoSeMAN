import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/csv/:agent/:days", controller.download);
router.get("/count/:sender", controller.countTxBySender);
router.get("/all", controller.all);
router.get("/all/:type", controller.allByType);
router.get("/:sensor", controller.sensor);

export default router;
