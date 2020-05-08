import express from "express";
import controller from "../controllers/csv";

const router = express.Router();

router.get("/:agent/:days", controller.download);

export default router;
