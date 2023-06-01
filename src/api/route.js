import express from "express";
import controller from "./controller";

const router = express.Router();

router.get("/last/:start/:end", controller.last);
router.get("/max/:start/:end/:type", controller.max);
router.get("/messages/:start/:end", controller.messages);
router.get("/cities", controller.cities);
router.get("/csv/:start/:end/:city", controller.csv);
router.get("/:sensor/:start/:end", controller.sensor);

export default router;
