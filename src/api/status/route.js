import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/last-block", controller.lastBlock);
router.get("/agents", controller.agents);

export default router;
