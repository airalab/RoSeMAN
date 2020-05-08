import express from "express";
import controller from "../controllers/sensor";

const router = express.Router();

router.get("/all", controller.all);
router.get("/all/:type", controller.allByType);
router.get("/:sender", controller.sender);

export default router;
