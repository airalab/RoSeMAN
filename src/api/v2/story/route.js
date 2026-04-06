import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/list", controller.list);
router.get("/last/:sensor_id", controller.last);

export default router;
