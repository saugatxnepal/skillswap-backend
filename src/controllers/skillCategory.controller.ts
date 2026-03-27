import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { Role } from "../constants/roles";

// Helper function to safely get string from query parameter
const getQueryString = (param: any): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param)) return param[0];
  return undefined;
};

// Helper function to safely get number from query parameter
const getQueryNumber = (param: any, defaultValue: number): number => {
  const str = getQueryString(param);
  if (!str) return defaultValue;
  const num = parseInt(str, 10);
  return isNaN(num) ? defaultValue : num;
};

// Helper function to safely get boolean from query parameter
const getQueryBoolean = (param: any): boolean => {
  const str = getQueryString(param);
  return str === 'true';
};

// Create Skill Category (Admin only)
export const createSkillCategory = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      const currentUserRole = (req as any).user?.role;
      
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can create skill categories")],
        });
      }

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          errors: [formatError("name", "Category name is required")],
        });
      }

      const trimmedName = name.trim();

      const existingCategory = await query(
        'SELECT * FROM "SkillCategory" WHERE "Name" = $1',
        [trimmedName],
      );

      if ((existingCategory.rowCount ?? 0) > 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("name", "Skill category with this name already exists")],
        });
      }

      const insertResult = await query(
        `INSERT INTO "SkillCategory" ("SkillCategoryID", "Name", "Description")
         VALUES (gen_random_uuid(), $1, $2)
         RETURNING *`,
        [trimmedName, description || null],
      );

      return res.status(201).json({
        success: true,
        data: insertResult.rows[0],
      });
    } catch (error) {
      console.error("Create skill category error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Bulk Insert Skill Categories (Admin only)
export const bulkCreateSkillCategories = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { categories } = req.body;
      const currentUserRole = (req as any).user?.role;

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can create skill categories")],
        });
      }

      if (!categories || !Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("categories", "Categories array is required and cannot be empty")],
        });
      }

      const validCategories = [];
      const errors = [];

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        
        if (!category.name || !category.name.trim()) {
          errors.push(`Item ${i}: Name is required`);
          continue;
        }

        validCategories.push({
          name: category.name.trim(),
          description: category.description || null,
        });
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          errors: errors.map(err => formatError("categories", err)),
        });
      }

      const names = validCategories.map(c => c.name);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(',');
      
      const existingCategories = await query(
        `SELECT "Name" FROM "SkillCategory" WHERE "Name" IN (${placeholders})`,
        names,
      );

      const existingNames = new Set(existingCategories.rows.map(c => c.Name));
      const newCategories = validCategories.filter(c => !existingNames.has(c.name));

      if (newCategories.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("categories", "All categories already exist")],
        });
      }

      const valuesPlaceholders = newCategories.map((_, i) => 
        `(gen_random_uuid(), $${i * 2 + 1}, $${i * 2 + 2})`
      ).join(',');

      const flattenedValues = newCategories.flatMap(c => [c.name, c.description]);

      const insertResult = await query(
        `INSERT INTO "SkillCategory" ("SkillCategoryID", "Name", "Description")
         VALUES ${valuesPlaceholders}
         RETURNING *`,
        flattenedValues,
      );

      return res.status(201).json({
        success: true,
        data: {
          inserted: insertResult.rows,
          skipped: validCategories.length - newCategories.length,
          total: validCategories.length,
        },
      });
    } catch (error) {
      console.error("Bulk create skill categories error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get All Skill Categories (with pagination)
export const getAllSkillCategories = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const page = getQueryNumber(req.query.page, 1);
      const limit = getQueryNumber(req.query.limit, 20);
      const offset = (page - 1) * limit;
      const search = getQueryString(req.query.search);

      let queryText = `SELECT * FROM "SkillCategory"`;
      const queryParams: any[] = [];

      if (search) {
        queryText += ` WHERE "Name" ILIKE $1 OR "Description" ILIKE $1`;
        queryParams.push(`%${search}%`);
      }

      const countQuery = search
        ? `SELECT COUNT(*) FROM "SkillCategory" WHERE "Name" ILIKE $1 OR "Description" ILIKE $1`
        : `SELECT COUNT(*) FROM "SkillCategory"`;
      
      const countResult = await query(
        countQuery,
        search ? [`%${search}%`] : []
      );
      const total = parseInt(countResult.rows[0].count);

      queryText += ` ORDER BY "Name" LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
      queryParams.push(limit, offset);

      const result = await query(queryText, queryParams);

      return res.status(200).json({
        success: true,
        data: {
          categories: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("Get all skill categories error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get Skill Category by ID
export const getSkillCategoryById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      const includeSkills = getQueryBoolean(req.query.includeSkills);

      if (!id) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "Category ID is required")],
        });
      }

      const result = await query(
        `SELECT * FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("category", "Skill category not found")],
        });
      }

      const baseCategory = result.rows[0];
      let category: any = baseCategory;

      if (includeSkills) {
        const skillsResult = await query(
          `SELECT * FROM "Skill" WHERE "SkillCategoryID" = $1 ORDER BY "Name"`,
          [id],
        );
        category = { ...baseCategory, skills: skillsResult.rows };
      }

      return res.status(200).json({
        success: true,
        data: category,
      });
    } catch (error) {
      console.error("Get skill category by ID error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update Skill Category (Admin only)
export const updateSkillCategory = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      const { name, description } = req.body;
      const currentUserRole = (req as any).user?.role;

      if (!id) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "Category ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update skill categories")],
        });
      }

      const existingCategory = await query(
        `SELECT * FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      if (existingCategory.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("category", "Skill category not found")],
        });
      }

      if (name && name.trim() !== existingCategory.rows[0].Name) {
        const duplicateCheck = await query(
          `SELECT * FROM "SkillCategory" WHERE "Name" = $1 AND "SkillCategoryID" != $2`,
          [name.trim(), id],
        );

        if ((duplicateCheck.rowCount ?? 0) > 0) {
          return res.status(400).json({
            success: false,
            errors: [formatError("name", "Skill category with this name already exists")],
          });
        }
      }

      const updateResult = await query(
        `UPDATE "SkillCategory" 
         SET "Name" = COALESCE($1, "Name"), 
             "Description" = COALESCE($2, "Description")
         WHERE "SkillCategoryID" = $3
         RETURNING *`,
        [name?.trim() || null, description || null, id],
      );

      return res.status(200).json({
        success: true,
        data: updateResult.rows[0],
      });
    } catch (error) {
      console.error("Update skill category error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Delete Skill Category (Admin only)
export const deleteSkillCategory = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;

      if (!id) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "Category ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can delete skill categories")],
        });
      }

      const categoryCheck = await query(
        `SELECT * FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      if (categoryCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("category", "Skill category not found")],
        });
      }

      const skillsCheck = await query(
        `SELECT COUNT(*) FROM "Skill" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      const skillsCount = parseInt(skillsCheck.rows[0].count);

      if (skillsCount > 0) {
        return res.status(400).json({
          success: false,
          errors: [
            formatError(
              "category", 
              `Cannot delete category with ${skillsCount} associated skills. Move or delete the skills first.`
            ),
          ],
        });
      }

      await query(
        `DELETE FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      return res.status(200).json({
        success: true,
        message: "Skill category deleted successfully",
      });
    } catch (error) {
      console.error("Delete skill category error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get all skill categories (simple list for dropdowns)
export const getAllSkillCategoriesSimple = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT "SkillCategoryID", "Name" FROM "SkillCategory" ORDER BY "Name"`,
      );

      return res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Get simple skill categories error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get featured skill categories
export const getFeaturedSkillCategories = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const limit = getQueryNumber(req.query.limit, 10);

      const result = await query(
        `SELECT sc.*, COUNT(s."SkillID") as skill_count
         FROM "SkillCategory" sc
         LEFT JOIN "Skill" s ON sc."SkillCategoryID" = s."SkillCategoryID"
         GROUP BY sc."SkillCategoryID"
         ORDER BY skill_count DESC
         LIMIT $1`,
        [limit],
      );

      return res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Get featured categories error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get category statistics
export const getSkillCategoryStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "Category ID is required")],
        });
      }

      const categoryCheck = await query(
        `SELECT * FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
        [id],
      );

      if (categoryCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("category", "Skill category not found")],
        });
      }

      const statsResult = await query(
        `SELECT 
           COUNT(DISTINCT s."SkillID") as total_skills,
           COUNT(DISTINCT us."UserSkillID") as total_user_skills,
           COUNT(DISTINCT CASE WHEN us."IsMentor" = true THEN us."UserID" END) as total_mentors,
           COUNT(DISTINCT CASE WHEN us."IsLearner" = true THEN us."UserID" END) as total_learners,
           AVG(us."ExperienceLevel") as avg_experience_level
         FROM "SkillCategory" sc
         LEFT JOIN "Skill" s ON sc."SkillCategoryID" = s."SkillCategoryID"
         LEFT JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
         WHERE sc."SkillCategoryID" = $1
         GROUP BY sc."SkillCategoryID"`,
        [id],
      );

      const stats = statsResult.rows[0] || {
        total_skills: 0,
        total_user_skills: 0,
        total_mentors: 0,
        total_learners: 0,
        avg_experience_level: null,
      };

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Get category stats error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);