import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/all", controller.all);

export default router;
