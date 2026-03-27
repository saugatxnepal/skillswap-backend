import { Router } from "express";
import {
  createSkillCategory,
  bulkCreateSkillCategories,
  getAllSkillCategories,
  getSkillCategoryById,
  updateSkillCategory,
  deleteSkillCategory,
} from "../controllers/skillCategory.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// GET requests with cache
router.get(
  "/",
  getAllSkillCategories
);

router.get(
  "/:id",
  getSkillCategoryById
);


// Admin only routes
router.post("/", authenticateJWT, createSkillCategory);
router.post("/bulk", authenticateJWT, bulkCreateSkillCategories);
router.put("/:id", authenticateJWT, updateSkillCategory);
router.delete("/:id", authenticateJWT, deleteSkillCategory);

export default router;