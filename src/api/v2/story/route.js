import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/last/:sensor_id", controller.last);

export default router;
