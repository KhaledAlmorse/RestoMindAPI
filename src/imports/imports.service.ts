import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import slugify from 'slugify';
import {
  CategoryRepository,
  ImportJobRepository,
  IngredientRepository,
  InventoryBatchRepository,
  ProductRepository,
  RecipeRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  StockTransactionRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreateImportDto } from './dto/create-import.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { QueryImportDto } from './dto/query-import.dto';
import { CsvParsingService } from './services/csv-parsing.service';
import { AiIngestService } from './services/ai-ingest.service';
import {
  ImportJobStatusEnum,
  ImportTypeEnum,
  SalesSourceEnum,
  StockTransactionTypeEnum,
} from 'src/Common/Types';

@Injectable()
export class ImportsService {
  constructor(
    private readonly importJobRepository: ImportJobRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    private readonly productRepository: ProductRepository,
    private readonly recipeRepository: RecipeRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockTransactionRepository: StockTransactionRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly csvParsingService: CsvParsingService,
    private readonly aiIngestService: AiIngestService,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
  }

  async createImport(
    file: Express.Multer.File,
    dto: CreateImportDto,
    userId: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const restaurantId = await this.getManagerRestaurantId(userId);
    const { headers, rawRows } = this.csvParsingService.parseCsv(file.buffer);

    if (rawRows.length === 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    const suggestedMapping = this.csvParsingService.autoSuggestMapping(
      headers,
      dto.importType,
    );

    const job = await this.importJobRepository.create({
      restaurantId,
      uploadedBy: new Types.ObjectId(userId),
      importType: dto.importType,
      fileName: file.originalname || 'upload.csv',
      columnMapping: suggestedMapping,
      rawRows,
      status: ImportJobStatusEnum.PROCESSING,
      totalRows: rawRows.length,
      validRows: 0,
      invalidRows: 0,
      errors: [],
      aiIngestAttempts: 0,
    } as any);

    return {
      data: {
        importJobId: job._id,
        fileName: job.fileName,
        importType: job.importType,
        status: job.status,
        detectedHeaders: headers,
        suggestedMapping,
        totalRows: rawRows.length,
      },
    };
  }

  async previewImport(
    importId: string,
    columnMapping: Record<string, string> | undefined,
    userId: string,
  ) {
    this.validateObjectId(importId);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const job = await this.importJobRepository.findOne({
      filters: {
        _id: new Types.ObjectId(importId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    const rawRows = job.rawRows || [];
    if (rawRows.length === 0) {
      throw new BadRequestException('No rows found in import job');
    }

    const headers =
      rawRows.length > 0 && job.columnMapping
        ? Object.keys(job.columnMapping)
        : [];

    const effectiveMapping = columnMapping || job.columnMapping || {};

    const previewRows = rawRows.slice(0, 5).map((row) => {
      const mapped: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const target = effectiveMapping[h];
        if (target) {
          mapped[target] = row[idx] || '';
        }
      });
      return mapped;
    });

    return {
      data: {
        importJobId: job._id,
        fileName: job.fileName,
        importType: job.importType,
        status: job.status,
        totalRows: job.totalRows,
        columnMapping: effectiveMapping,
        previewRows,
      },
    };
  }

  async confirmImport(importId: string, dto: ConfirmImportDto, userId: string) {
    this.validateObjectId(importId);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const job = await this.importJobRepository.findOne({
      filters: {
        _id: new Types.ObjectId(importId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    if (job.status === ImportJobStatusEnum.COMPLETED) {
      throw new BadRequestException('Import job is already completed');
    }

    const rawRows = job.rawRows || [];
    if (rawRows.length === 0) {
      throw new BadRequestException('Import job contains no data rows');
    }

    const effectiveMapping = dto.columnMapping || job.columnMapping || {};
    const headers = Object.keys(effectiveMapping);

    // Fetch existing master data for validation
    const products =
      (await this.productRepository.findMany({
        filters: { restaurantId, isDeleted: false },
      })) || [];

    const ingredients =
      (await this.ingredientRepository.findMany({
        filters: { restaurantId, isDeleted: false },
      })) || [];

    let createdCount = 0;
    let finalStatus: ImportJobStatusEnum = ImportJobStatusEnum.COMPLETED;
    let aiLastError: string | undefined = undefined;

    // ----------------------------------------------------
    // 1. MENU_ITEMS IMPORT STRATEGY
    // ----------------------------------------------------
    if (job.importType === ImportTypeEnum.MENU_ITEMS) {
      const { validRows, errors } = this.csvParsingService.mapAndValidateRows(
        ImportTypeEnum.MENU_ITEMS,
        rawRows,
        headers,
        effectiveMapping,
      );

      for (const row of validRows) {
        const existingProduct = await this.productRepository.findOne({
          filters: { restaurantId, title: row.title, isDeleted: false },
        });

        const categoryName = row.category || 'General';
        let category = await this.categoryRepository.findOne({
          filters: { name: categoryName, isDeleted: false },
        });

        if (!category) {
          category = await this.categoryRepository.create({
            name: categoryName,
            description: `Category for ${categoryName}`,
            image: {
              public_id: 'default_category',
              secure_url:
                'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500',
            },
          } as any);
        }

        const productSlug = slugify(
          `${row.title}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          { lower: true },
        );
        const defaultImage = {
          public_id: 'default_product',
          secure_url:
            'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500',
        };

        if (existingProduct) {
          await this.productRepository.update({
            filters: { _id: existingProduct._id },
            body: {
              price: row.price,
              freshnessWindow: row.freshnessWindow,
              category: category._id,
              description:
                row.description || existingProduct.description || row.title,
              longDescription:
                row.longDescription ||
                existingProduct.longDescription ||
                row.title,
            },
          });
        } else {
          await this.productRepository.create({
            restaurantId,
            title: row.title,
            slug: productSlug,
            description: row.description || row.title,
            longDescription:
              row.longDescription || row.description || row.title,
            price: row.price,
            freshnessWindow: row.freshnessWindow,
            category: category._id,
            image: defaultImage,
          } as any);
        }
        createdCount++;
      }

      finalStatus =
        validRows.length > 0
          ? ImportJobStatusEnum.COMPLETED
          : ImportJobStatusEnum.FAILED;

      const updatedJob = await this.importJobRepository.findOneAndUpdate({
        filters: { _id: job._id },
        updateData: {
          columnMapping: effectiveMapping,
          totalRows: rawRows.length,
          validRows: validRows.length,
          invalidRows: rawRows.length - validRows.length,
          errors,
          status: finalStatus,
        },
      });

      return {
        data: {
          importJobId: updatedJob!._id,
          status: updatedJob!.status,
          totalRows: updatedJob!.totalRows,
          validRows: updatedJob!.validRows,
          invalidRows: updatedJob!.invalidRows,
          errors: updatedJob!.errors,
          importedCount: createdCount,
        },
      };
    }

    // ----------------------------------------------------
    // 2. INGREDIENTS IMPORT STRATEGY
    // ----------------------------------------------------
    if (job.importType === ImportTypeEnum.INGREDIENTS) {
      const { validRows, errors } = this.csvParsingService.mapAndValidateRows(
        ImportTypeEnum.INGREDIENTS,
        rawRows,
        headers,
        effectiveMapping,
      );

      for (const row of validRows) {
        let existingIngredient = await this.ingredientRepository.findOne({
          filters: {
            restaurantId,
            ingredientCode: row.ingredientCode,
            isDeleted: false,
          },
        });

        if (!existingIngredient && row.name) {
          existingIngredient = await this.ingredientRepository.findOne({
            filters: { restaurantId, name: row.name, isDeleted: false },
          });
        }

        if (existingIngredient) {
          await this.ingredientRepository.update({
            filters: { _id: existingIngredient._id },
            body: {
              name: row.name,
              unit: row.unit,
              shelfLifeDays: row.shelfLifeDays,
              minimumStock: row.minimumStock,
              safetyStock: row.safetyStock,
            },
          });
        } else {
          await this.ingredientRepository.create({
            restaurantId,
            ingredientCode: row.ingredientCode,
            name: row.name,
            unit: row.unit,
            shelfLifeDays: row.shelfLifeDays,
            minimumStock: row.minimumStock,
            safetyStock: row.safetyStock,
          } as any);
        }
        createdCount++;
      }

      finalStatus =
        validRows.length > 0
          ? ImportJobStatusEnum.COMPLETED
          : ImportJobStatusEnum.FAILED;

      const updatedJob = await this.importJobRepository.findOneAndUpdate({
        filters: { _id: job._id },
        updateData: {
          columnMapping: effectiveMapping,
          totalRows: rawRows.length,
          validRows: validRows.length,
          invalidRows: rawRows.length - validRows.length,
          errors,
          status: finalStatus,
        },
      });

      return {
        data: {
          importJobId: updatedJob!._id,
          status: updatedJob!.status,
          totalRows: updatedJob!.totalRows,
          validRows: updatedJob!.validRows,
          invalidRows: updatedJob!.invalidRows,
          errors: updatedJob!.errors,
          importedCount: createdCount,
        },
      };
    }

    // ----------------------------------------------------
    // 3. RECIPES IMPORT STRATEGY + DEPENDENCY GUARDS
    // ----------------------------------------------------
    if (job.importType === ImportTypeEnum.RECIPES) {
      if (products.length === 0) {
        const guardError = {
          row: 0,
          column: 'productId',
          message:
            'Cannot import recipes before onboarding menu items. Please import menu_items first.',
        };

        const updatedJob = await this.importJobRepository.findOneAndUpdate({
          filters: { _id: job._id },
          updateData: {
            columnMapping: effectiveMapping,
            totalRows: rawRows.length,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: [guardError],
            status: ImportJobStatusEnum.FAILED,
          },
        });

        return {
          data: {
            importJobId: updatedJob!._id,
            status: updatedJob!.status,
            totalRows: updatedJob!.totalRows,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: updatedJob!.errors,
            importedCount: 0,
          },
        };
      }

      if (ingredients.length === 0) {
        const guardError = {
          row: 0,
          column: 'ingredientId',
          message:
            'Cannot import recipes before onboarding ingredients. Please import ingredients first.',
        };

        const updatedJob = await this.importJobRepository.findOneAndUpdate({
          filters: { _id: job._id },
          updateData: {
            columnMapping: effectiveMapping,
            totalRows: rawRows.length,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: [guardError],
            status: ImportJobStatusEnum.FAILED,
          },
        });

        return {
          data: {
            importJobId: updatedJob!._id,
            status: updatedJob!.status,
            totalRows: updatedJob!.totalRows,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: updatedJob!.errors,
            importedCount: 0,
          },
        };
      }

      const { validRows, errors } = this.csvParsingService.mapAndValidateRows(
        ImportTypeEnum.RECIPES,
        rawRows,
        headers,
        effectiveMapping,
        products,
        ingredients,
      );

      // Group valid rows by productId
      const recipeGroups = new Map<string, any[]>();
      validRows.forEach((row) => {
        const pId = row.productId.toString();
        if (!recipeGroups.has(pId)) recipeGroups.set(pId, []);
        recipeGroups.get(pId)!.push({
          ingredientId: new Types.ObjectId(row.ingredientId.toString()),
          quantityPerPortion: row.quantityPerPortion,
          unit: row.unit,
          yieldPercentage: row.yieldPercentage || 100,
        });
      });

      for (const [prodIdStr, ingList] of recipeGroups.entries()) {
        const pId = new Types.ObjectId(prodIdStr);
        const existingRecipe = await this.recipeRepository.findOne({
          filters: { restaurantId, productId: pId, isDeleted: false },
        });

        if (existingRecipe) {
          await this.recipeRepository.update({
            filters: { _id: existingRecipe._id },
            body: { ingredients: ingList },
          });
        } else {
          await this.recipeRepository.create({
            restaurantId,
            productId: pId,
            ingredients: ingList,
          } as any);
        }
        createdCount++;
      }

      finalStatus =
        validRows.length > 0
          ? ImportJobStatusEnum.COMPLETED
          : ImportJobStatusEnum.FAILED;

      const updatedJob = await this.importJobRepository.findOneAndUpdate({
        filters: { _id: job._id },
        updateData: {
          columnMapping: effectiveMapping,
          totalRows: rawRows.length,
          validRows: validRows.length,
          invalidRows: rawRows.length - validRows.length,
          errors,
          status: finalStatus,
        },
      });

      return {
        data: {
          importJobId: updatedJob!._id,
          status: updatedJob!.status,
          totalRows: updatedJob!.totalRows,
          validRows: updatedJob!.validRows,
          invalidRows: updatedJob!.invalidRows,
          errors: updatedJob!.errors,
          importedCount: createdCount,
        },
      };
    }

    // ----------------------------------------------------
    // 4. INVENTORY_TRANSACTIONS IMPORT STRATEGY + DEPENDENCY GUARD
    // ----------------------------------------------------
    if (job.importType === ImportTypeEnum.INVENTORY_TRANSACTIONS) {
      if (ingredients.length === 0) {
        const guardError = {
          row: 0,
          column: 'ingredientId',
          message:
            'Cannot import inventory transactions before onboarding ingredients. Please import ingredients first.',
        };

        const updatedJob = await this.importJobRepository.findOneAndUpdate({
          filters: { _id: job._id },
          updateData: {
            columnMapping: effectiveMapping,
            totalRows: rawRows.length,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: [guardError],
            status: ImportJobStatusEnum.FAILED,
          },
        });

        return {
          data: {
            importJobId: updatedJob!._id,
            status: updatedJob!.status,
            totalRows: updatedJob!.totalRows,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: updatedJob!.errors,
            importedCount: 0,
          },
        };
      }

      const { validRows, errors } = this.csvParsingService.mapAndValidateRows(
        ImportTypeEnum.INVENTORY_TRANSACTIONS,
        rawRows,
        headers,
        effectiveMapping,
        [],
        ingredients,
      );

      for (const row of validRows) {
        const batch = await this.inventoryBatchRepository.create({
          restaurantId,
          ingredientId: new Types.ObjectId(row.ingredientId.toString()),
          batchNumber: row.batchNumber,
          quantityRemaining: row.quantity,
          unitCost: row.unitCost,
          expiryDate: row.expiryDate,
          receivedDate: new Date(),
        } as any);

        await this.stockTransactionRepository.create({
          restaurantId,
          ingredientId: new Types.ObjectId(row.ingredientId.toString()),
          batchId: batch._id,
          transactionType: StockTransactionTypeEnum.PURCHASE,
          quantity: row.quantity,
          unit: row.unit,
          date: new Date(),
        } as any);

        createdCount++;
      }

      finalStatus =
        validRows.length > 0
          ? ImportJobStatusEnum.COMPLETED
          : ImportJobStatusEnum.FAILED;

      const updatedJob = await this.importJobRepository.findOneAndUpdate({
        filters: { _id: job._id },
        updateData: {
          columnMapping: effectiveMapping,
          totalRows: rawRows.length,
          validRows: validRows.length,
          invalidRows: rawRows.length - validRows.length,
          errors,
          status: finalStatus,
        },
      });

      return {
        data: {
          importJobId: updatedJob!._id,
          status: updatedJob!.status,
          totalRows: updatedJob!.totalRows,
          validRows: updatedJob!.validRows,
          invalidRows: updatedJob!.invalidRows,
          errors: updatedJob!.errors,
          importedCount: createdCount,
        },
      };
    }

    // ----------------------------------------------------
    // 4. SALES_HISTORY IMPORT STRATEGY + PRE-VALIDATION GUARD
    // ----------------------------------------------------
    if (job.importType === ImportTypeEnum.SALES_HISTORY) {
      // Pre-validation Guard: Restaurant must have active products before sales history import
      if (products.length === 0) {
        const guardError = {
          row: 0,
          column: 'productId',
          message:
            'Cannot import sales history before onboarding menu items. Please import menu_items first.',
        };

        const updatedJob = await this.importJobRepository.findOneAndUpdate({
          filters: { _id: job._id },
          updateData: {
            columnMapping: effectiveMapping,
            totalRows: rawRows.length,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: [guardError],
            status: ImportJobStatusEnum.FAILED,
          },
        });

        return {
          data: {
            importJobId: updatedJob!._id,
            status: updatedJob!.status,
            totalRows: updatedJob!.totalRows,
            validRows: 0,
            invalidRows: rawRows.length,
            errors: updatedJob!.errors,
            importedCount: 0,
          },
        };
      }

      const { validRows, errors } = this.csvParsingService.mapAndValidateRows(
        ImportTypeEnum.SALES_HISTORY,
        rawRows,
        headers,
        effectiveMapping,
        products,
      );

      let createdTransactions: any[] = [];

      if (validRows.length > 0) {
        const transactionsToInsert = validRows.map((row) => ({
          restaurantId,
          productId: row.productId,
          date: row.date,
          quantitySold: row.quantitySold,
          sellingPrice: row.sellingPrice,
          basePrice: row.basePrice,
          source: SalesSourceEnum.CSV_IMPORT,
          importJobId: job._id,
          offerId:
            row.offerId && isValidObjectId(row.offerId)
              ? new Types.ObjectId(row.offerId)
              : null,
        }));

        createdTransactions = await (
          this.salesTransactionRepository as any
        ).createMany(transactionsToInsert);
      }

      const validCount = validRows.length;
      const invalidCount = rawRows.length - validCount;

      // Trigger AI Auto-Ingest if valid rows exist
      if (validCount > 0) {
        const recordsPayload = validRows.map((r) => ({
          date: r.date.toISOString().split('T')[0],
          productId: r.productId.toString(),
          salesQty: r.quantitySold,
        }));

        const productsPayload = products.map((p: any) => ({
          productId: p._id.toString(),
          title: p.title,
          category: p.category || 'General',
        }));

        const aiResult = await this.aiIngestService.ingest({
          restaurantId: restaurantId.toString(),
          records: recordsPayload,
          products: productsPayload,
        });

        if (aiResult.success) {
          finalStatus = ImportJobStatusEnum.COMPLETED;
        } else {
          finalStatus = ImportJobStatusEnum.AI_INGEST_FAILED;
          aiLastError = aiResult.error;
        }
      } else {
        finalStatus = ImportJobStatusEnum.FAILED;
      }

      const updatedJob = await this.importJobRepository.findOneAndUpdate({
        filters: { _id: job._id },
        updateData: {
          columnMapping: effectiveMapping,
          totalRows: rawRows.length,
          validRows: validCount,
          invalidRows: invalidCount,
          errors,
          status: finalStatus,
          aiIngestAttempts:
            finalStatus === ImportJobStatusEnum.AI_INGEST_FAILED ? 3 : 0,
          aiIngestLastError: aiLastError,
        },
      });

      return {
        data: {
          importJobId: updatedJob!._id,
          status: updatedJob!.status,
          totalRows: updatedJob!.totalRows,
          validRows: updatedJob!.validRows,
          invalidRows: updatedJob!.invalidRows,
          errors: updatedJob!.errors,
          aiIngestLastError: updatedJob!.aiIngestLastError,
          importedCount: createdTransactions.length,
        },
      };
    }

    throw new BadRequestException(`Unsupported import type: ${job.importType}`);
  }

  async getImportJobs(query: QueryImportDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', importType, status } = query;

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const pageNum = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limitNum =
      Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : parsedLimit;
    const skip = (pageNum - 1) * limitNum;

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
    };

    if (importType) {
      filters.importType = importType;
    }
    if (status) {
      filters.status = status;
    }

    return this.importJobRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
    });
  }

  async getImportJobById(importId: string, userId: string) {
    this.validateObjectId(importId);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const job = await this.importJobRepository.findOne({
      filters: {
        _id: new Types.ObjectId(importId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    return { data: job };
  }

  async retryAiIngest(importId: string, userId: string) {
    this.validateObjectId(importId);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const job = await this.importJobRepository.findOne({
      filters: {
        _id: new Types.ObjectId(importId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    if (job.importType !== ImportTypeEnum.SALES_HISTORY) {
      throw new BadRequestException(
        'Retry AI ingest is only applicable for sales_history imports',
      );
    }

    // Fetch transactions created by this import job
    const transactions =
      (await this.salesTransactionRepository.findMany({
        filters: { importJobId: job._id, restaurantId, isDeleted: false },
      })) || [];

    if (transactions.length === 0) {
      throw new BadRequestException(
        'No written transactions found for this import job to ingest',
      );
    }

    const products =
      (await this.productRepository.findMany({
        filters: { restaurantId, isDeleted: false },
      })) || [];

    const recordsPayload = transactions.map((t) => ({
      date: new Date(t.date).toISOString().split('T')[0],
      productId: t.productId.toString(),
      salesQty: t.quantitySold,
    }));

    const productsPayload = products.map((p: any) => ({
      productId: p._id.toString(),
      title: p.title,
      category: p.category || 'General',
    }));

    const aiResult = await this.aiIngestService.ingest({
      restaurantId: restaurantId.toString(),
      records: recordsPayload,
      products: productsPayload,
    });

    const newAttempts = (job.aiIngestAttempts || 0) + aiResult.attempts;
    const newStatus = aiResult.success
      ? ImportJobStatusEnum.COMPLETED
      : ImportJobStatusEnum.AI_INGEST_FAILED;

    const updatedJob = await this.importJobRepository.findOneAndUpdate({
      filters: { _id: job._id },
      updateData: {
        status: newStatus,
        aiIngestAttempts: newAttempts,
        aiIngestLastError: aiResult.error || undefined,
      },
    });

    if (!updatedJob) {
      throw new NotFoundException('Failed to update import job');
    }

    return { data: updatedJob };
  }
}
