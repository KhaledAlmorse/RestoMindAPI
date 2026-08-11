import { Injectable, BadRequestException } from '@nestjs/common';
import { ImportTypeEnum, IngredientUnitEnum } from 'src/Common/Types';
import { parseBusinessDate } from 'src/Common/Utils/date.util';

export interface CsvParseResult {
  headers: string[];
  rawRows: string[][];
}

export interface ValidationErrorDetail {
  row: number;
  column?: string;
  message: string;
}

export interface MapAndValidateResult {
  validRows: any[];
  errors: ValidationErrorDetail[];
}

@Injectable()
export class CsvParsingService {
  /**
   * Parses raw CSV content (string or Buffer) into headers and raw text row matrix.
   * Handles RFC 4180 CSV rules: quotes, commas, newlines.
   */
  parseCsv(content: string | Buffer): CsvParseResult {
    const text =
      typeof content === 'string' ? content : content.toString('utf-8');
    const lines = this.splitCsvLines(text);

    if (lines.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const headers = lines[0].map((h) => h.trim());
    const rawRows = lines
      .slice(1)
      .filter((row) => row.some((cell) => cell.trim().length > 0));

    return { headers, rawRows };
  }

  /**
   * Suggests standard column mapping based on header strings.
   */
  autoSuggestMapping(
    headers: string[],
    importType: ImportTypeEnum,
  ): Record<string, string> {
    const mapping: Record<string, string> = {};

    headers.forEach((header) => {
      const lower = header.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (importType === ImportTypeEnum.MENU_ITEMS) {
        if (
          ['title', 'name', 'productname', 'itemname', 'producttitle'].includes(
            lower,
          )
        ) {
          mapping[header] = 'title';
        } else if (
          ['price', 'sellingprice', 'unitprice', 'cost'].includes(lower)
        ) {
          mapping[header] = 'price';
        } else if (['category', 'categoryname', 'cat'].includes(lower)) {
          mapping[header] = 'category';
        } else if (
          [
            'freshnesswindow',
            'freshness',
            'shelflife',
            'freshnessdays',
          ].includes(lower)
        ) {
          mapping[header] = 'freshnessWindow';
        } else if (['description', 'desc'].includes(lower)) {
          mapping[header] = 'description';
        }
      } else if (importType === ImportTypeEnum.INGREDIENTS) {
        if (
          ['name', 'ingredientname', 'itemname', 'ingredient'].includes(lower)
        ) {
          mapping[header] = 'name';
        } else if (
          ['ingredientcode', 'code', 'itemcode', 'sku'].includes(lower)
        ) {
          mapping[header] = 'ingredientCode';
        } else if (['unit', 'uom', 'measurementunit'].includes(lower)) {
          mapping[header] = 'unit';
        } else if (['shelflifedays', 'shelflife', 'expiry'].includes(lower)) {
          mapping[header] = 'shelfLifeDays';
        } else if (['minimumstock', 'minstock', 'min'].includes(lower)) {
          mapping[header] = 'minimumStock';
        } else if (['safetystock', 'safetylevel'].includes(lower)) {
          mapping[header] = 'safetyStock';
        }
      } else if (importType === ImportTypeEnum.RECIPES) {
        if (
          [
            'productid',
            'product',
            'producttitle',
            'item',
            'title',
            'sku',
          ].includes(lower)
        ) {
          mapping[header] = 'productId';
        } else if (
          [
            'ingredientid',
            'ingredient',
            'ingredientcode',
            'ingredientname',
            'rawmaterial',
          ].includes(lower)
        ) {
          mapping[header] = 'ingredientId';
        } else if (
          [
            'quantityperportion',
            'quantity',
            'qty',
            'portionqty',
            'amount',
          ].includes(lower)
        ) {
          mapping[header] = 'quantityPerPortion';
        } else if (['unit', 'uom', 'measurementunit'].includes(lower)) {
          mapping[header] = 'unit';
        } else if (['yieldpercentage', 'yield', 'yieldpct'].includes(lower)) {
          mapping[header] = 'yieldPercentage';
        }
      } else if (importType === ImportTypeEnum.INVENTORY_TRANSACTIONS) {
        if (
          [
            'ingredientid',
            'ingredient',
            'ingredientcode',
            'ingredientname',
            'rawmaterial',
          ].includes(lower)
        ) {
          mapping[header] = 'ingredientId';
        } else if (
          ['batchnumber', 'batch', 'batchno', 'batchlot', 'lot'].includes(lower)
        ) {
          mapping[header] = 'batchNumber';
        } else if (
          ['quantity', 'qty', 'quantityremaining', 'amount'].includes(lower)
        ) {
          mapping[header] = 'quantity';
        } else if (['unitcost', 'cost', 'priceperunit'].includes(lower)) {
          mapping[header] = 'unitCost';
        } else if (['expirydate', 'expdate', 'expiry'].includes(lower)) {
          mapping[header] = 'expiryDate';
        } else if (['unit', 'uom'].includes(lower)) {
          mapping[header] = 'unit';
        } else if (['transactiontype', 'type'].includes(lower)) {
          mapping[header] = 'transactionType';
        }
      } else if (importType === ImportTypeEnum.SALES_HISTORY) {
        if (
          ['date', 'saledate', 'transactiondate', 'orderdate'].includes(lower)
        ) {
          mapping[header] = 'date';
        } else if (
          [
            'productid',
            'product',
            'itemcode',
            'item',
            'title',
            'sku',
            'producttitle',
          ].includes(lower)
        ) {
          mapping[header] = 'productId';
        } else if (
          [
            'quantitysold',
            'quantity',
            'qty',
            'salesqty',
            'unitsold',
            'units',
          ].includes(lower)
        ) {
          mapping[header] = 'quantitySold';
        } else if (
          [
            'productionqty',
            'productionquantity',
            'producedqty',
            'producedquantity',
            'production',
            'produced',
            'actualproducedqty',
          ].includes(lower)
        ) {
          mapping[header] = 'productionQuantity';
        } else if (
          [
            'sellingprice',
            'price',
            'unitprice',
            'netprice',
            'salesprice',
          ].includes(lower)
        ) {
          mapping[header] = 'sellingPrice';
        } else if (
          ['baseprice', 'originalprice', 'grossprice'].includes(lower)
        ) {
          mapping[header] = 'basePrice';
        } else if (['offerid', 'offer', 'discountid'].includes(lower)) {
          mapping[header] = 'offerId';
        }
      }
    });

    return mapping;
  }

  /**
   * Maps raw rows according to user's columnMapping and validates fields.
   */
  mapAndValidateRows(
    importType: ImportTypeEnum,
    rawRows: string[][],
    headers: string[],
    columnMapping: Record<string, string>,
    products: any[] = [],
    ingredients: any[] = [],
  ): MapAndValidateResult {
    const validRows: any[] = [];
    const errors: ValidationErrorDetail[] = [];

    // Dictionary for product lookup by ID or Title (case-insensitive)
    const productMap = new Map<string, any>();
    products.forEach((p) => {
      if (p._id) productMap.set(p._id.toString(), p);
      if (p.title) productMap.set(p.title.trim().toLowerCase(), p);
    });

    // Dictionary for ingredient lookup by ID, ingredientCode, or name (case-insensitive)
    const ingredientMap = new Map<string, any>();
    ingredients.forEach((ing) => {
      if (ing._id) ingredientMap.set(ing._id.toString(), ing);
      if (ing.ingredientCode)
        ingredientMap.set(ing.ingredientCode.trim().toLowerCase(), ing);
      if (ing.name) ingredientMap.set(ing.name.trim().toLowerCase(), ing);
    });

    rawRows.forEach((row, rowIndex) => {
      const displayRow = rowIndex + 2; // 1-indexed header is row 1
      const mappedRow: Record<string, any> = {};

      headers.forEach((header, colIdx) => {
        const targetField = columnMapping[header];
        if (targetField) {
          mappedRow[targetField] = row[colIdx] ? row[colIdx].trim() : '';
        }
      });

      let hasError = false;

      if (importType === ImportTypeEnum.MENU_ITEMS) {
        // Title validation
        if (!mappedRow.title) {
          errors.push({
            row: displayRow,
            column: 'title',
            message: 'Product title is required',
          });
          hasError = true;
        }

        // Price validation
        const priceNum = Number(mappedRow.price);
        if (
          mappedRow.price === undefined ||
          mappedRow.price === '' ||
          isNaN(priceNum) ||
          priceNum < 0
        ) {
          errors.push({
            row: displayRow,
            column: 'price',
            message: `Price must be a non-negative number (got '${mappedRow.price}')`,
          });
          hasError = true;
        } else {
          mappedRow.price = priceNum;
        }

        // Optional freshness window
        const freshNum = Number(mappedRow.freshnessWindow);
        mappedRow.freshnessWindow =
          !isNaN(freshNum) && freshNum > 0 ? freshNum : 2;

        if (!hasError) {
          validRows.push(mappedRow);
        }
      } else if (importType === ImportTypeEnum.INGREDIENTS) {
        // Name validation
        if (!mappedRow.name) {
          errors.push({
            row: displayRow,
            column: 'name',
            message: 'Ingredient name is required',
          });
          hasError = true;
        }

        // Code auto-generation if not provided
        if (!mappedRow.ingredientCode && mappedRow.name) {
          mappedRow.ingredientCode =
            mappedRow.name.toUpperCase().replace(/[^A-Z0-9]/g, '') + '-01';
        }

        // Unit validation
        const validUnits = Object.values(IngredientUnitEnum);
        if (
          mappedRow.unit &&
          !validUnits.includes(mappedRow.unit.toLowerCase())
        ) {
          errors.push({
            row: displayRow,
            column: 'unit',
            message: `Invalid unit '${mappedRow.unit}'. Must be one of: ${validUnits.join(', ')}`,
          });
          hasError = true;
        } else {
          mappedRow.unit = mappedRow.unit
            ? (mappedRow.unit.toLowerCase() as IngredientUnitEnum)
            : IngredientUnitEnum.KG;
        }

        // Shelf life validation
        const shelfNum = Number(mappedRow.shelfLifeDays);
        mappedRow.shelfLifeDays =
          !isNaN(shelfNum) && shelfNum > 0 ? shelfNum : 30;

        // Stock bounds
        const minStockNum = Number(mappedRow.minimumStock);
        mappedRow.minimumStock =
          !isNaN(minStockNum) && minStockNum >= 0 ? minStockNum : 0;

        const safetyStockNum = Number(mappedRow.safetyStock);
        mappedRow.safetyStock =
          !isNaN(safetyStockNum) && safetyStockNum >= 0 ? safetyStockNum : 0;

        if (!hasError) {
          validRows.push(mappedRow);
        }
      } else if (importType === ImportTypeEnum.RECIPES) {
        // Product resolution
        const rawProduct = mappedRow.productId;
        if (!rawProduct) {
          errors.push({
            row: displayRow,
            column: 'productId',
            message: 'Product ID or Title is required',
          });
          hasError = true;
        } else {
          const matchedProduct =
            productMap.get(rawProduct) ||
            productMap.get(rawProduct.trim().toLowerCase());

          if (!matchedProduct) {
            errors.push({
              row: displayRow,
              column: 'productId',
              message: `Product '${rawProduct}' not found for this restaurant`,
            });
            hasError = true;
          } else {
            mappedRow.productRef = matchedProduct;
            mappedRow.productId = matchedProduct._id;
          }
        }

        // Ingredient resolution
        const rawIngredient = mappedRow.ingredientId;
        if (!rawIngredient) {
          errors.push({
            row: displayRow,
            column: 'ingredientId',
            message: 'Ingredient ID, Code, or Name is required',
          });
          hasError = true;
        } else {
          const matchedIngredient =
            ingredientMap.get(rawIngredient) ||
            ingredientMap.get(rawIngredient.trim().toLowerCase());

          if (!matchedIngredient) {
            errors.push({
              row: displayRow,
              column: 'ingredientId',
              message: `Ingredient '${rawIngredient}' not found for this restaurant`,
            });
            hasError = true;
          } else {
            mappedRow.ingredientRef = matchedIngredient;
            mappedRow.ingredientId = matchedIngredient._id;
          }
        }

        // Quantity per portion validation
        const qtyNum = Number(mappedRow.quantityPerPortion);
        if (
          mappedRow.quantityPerPortion === undefined ||
          mappedRow.quantityPerPortion === '' ||
          isNaN(qtyNum) ||
          qtyNum <= 0
        ) {
          errors.push({
            row: displayRow,
            column: 'quantityPerPortion',
            message: `quantityPerPortion must be a positive number (got '${mappedRow.quantityPerPortion}')`,
          });
          hasError = true;
        } else {
          mappedRow.quantityPerPortion = qtyNum;
        }

        // Unit resolution (default to ingredient's unit if not specified)
        mappedRow.unit =
          mappedRow.unit ||
          mappedRow.ingredientRef?.unit ||
          IngredientUnitEnum.KG;

        // Yield percentage (default 100)
        const yieldNum = Number(mappedRow.yieldPercentage);
        mappedRow.yieldPercentage =
          !isNaN(yieldNum) && yieldNum > 0 && yieldNum <= 100 ? yieldNum : 100;

        if (!hasError) {
          validRows.push(mappedRow);
        }
      } else if (importType === ImportTypeEnum.INVENTORY_TRANSACTIONS) {
        // Ingredient resolution
        const rawIngredient = mappedRow.ingredientId;
        if (!rawIngredient) {
          errors.push({
            row: displayRow,
            column: 'ingredientId',
            message: 'Ingredient ID, Code, or Name is required',
          });
          hasError = true;
        } else {
          const matchedIngredient =
            ingredientMap.get(rawIngredient) ||
            ingredientMap.get(rawIngredient.trim().toLowerCase());

          if (!matchedIngredient) {
            errors.push({
              row: displayRow,
              column: 'ingredientId',
              message: `Ingredient '${rawIngredient}' not found for this restaurant`,
            });
            hasError = true;
          } else {
            mappedRow.ingredientRef = matchedIngredient;
            mappedRow.ingredientId = matchedIngredient._id;
          }
        }

        // Quantity validation
        const qtyNum = Number(mappedRow.quantity);
        if (
          mappedRow.quantity === undefined ||
          mappedRow.quantity === '' ||
          isNaN(qtyNum) ||
          qtyNum <= 0
        ) {
          errors.push({
            row: displayRow,
            column: 'quantity',
            message: `quantity must be a positive number (got '${mappedRow.quantity}')`,
          });
          hasError = true;
        } else {
          mappedRow.quantity = qtyNum;
        }

        // Unit resolution
        mappedRow.unit =
          mappedRow.unit ||
          mappedRow.ingredientRef?.unit ||
          IngredientUnitEnum.KG;

        // Optional Unit Cost & Expiry Date
        const costNum = Number(mappedRow.unitCost);
        mappedRow.unitCost = !isNaN(costNum) && costNum >= 0 ? costNum : 0;
        mappedRow.batchNumber = mappedRow.batchNumber || `BATCH-${Date.now()}`;
        mappedRow.expiryDate = mappedRow.expiryDate
          ? new Date(mappedRow.expiryDate)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        if (!hasError) {
          validRows.push(mappedRow);
        }
      } else if (importType === ImportTypeEnum.SALES_HISTORY) {
        // Date validation
        const rawDate = mappedRow.date;
        if (!rawDate) {
          errors.push({
            row: displayRow,
            column: 'date',
            message: 'Date is required',
          });
          hasError = true;
        } else {
          // Cairo-anchored, not `new Date(rawDate)`: that reads `2026-01-15` as
          // UTC midnight but `01/15/2026` as local midnight, so on a Cairo
          // server the second form is stored as the previous day — which then
          // reaches the AI registry under the wrong date key and lands in the
          // wrong week at reconciliation time.
          const parsedDate = parseBusinessDate(rawDate);
          if (!parsedDate) {
            errors.push({
              row: displayRow,
              column: 'date',
              message: `Invalid date format: '${rawDate}'`,
            });
            hasError = true;
          } else {
            mappedRow.date = parsedDate;
          }
        }

        // Product resolution
        const rawProduct = mappedRow.productId;
        if (!rawProduct) {
          errors.push({
            row: displayRow,
            column: 'productId',
            message: 'Product ID or Title is required',
          });
          hasError = true;
        } else {
          const matchedProduct =
            productMap.get(rawProduct) ||
            productMap.get(rawProduct.trim().toLowerCase());

          if (!matchedProduct) {
            errors.push({
              row: displayRow,
              column: 'productId',
              message: `Product '${rawProduct}' not found in restaurant menu`,
            });
            hasError = true;
          } else {
            mappedRow.productRef = matchedProduct;
            mappedRow.productId = matchedProduct._id;
          }
        }

        // Quantity validation
        const rawQty = mappedRow.quantitySold;
        const qtyNum = Number(rawQty);
        if (
          rawQty === undefined ||
          rawQty === '' ||
          isNaN(qtyNum) ||
          qtyNum < 0
        ) {
          errors.push({
            row: displayRow,
            column: 'quantitySold',
            message: `quantitySold must be a non-negative number (got '${rawQty}')`,
          });
          hasError = true;
        } else {
          mappedRow.quantitySold = qtyNum;
        }

        // Production Quantity validation (Mandatory)
        const rawProdQty = mappedRow.productionQuantity;
        const prodQtyNum = Number(rawProdQty);
        if (
          rawProdQty === undefined ||
          rawProdQty === '' ||
          isNaN(prodQtyNum) ||
          prodQtyNum < 0
        ) {
          errors.push({
            row: displayRow,
            column: 'productionQuantity',
            message: `productionQuantity is mandatory and must be a non-negative number (got '${rawProdQty}')`,
          });
          hasError = true;
        } else {
          mappedRow.productionQuantity = prodQtyNum;
        }

        // Selling Price validation
        const rawPrice = mappedRow.sellingPrice;
        const priceNum = Number(rawPrice);
        if (
          rawPrice !== undefined &&
          rawPrice !== '' &&
          (isNaN(priceNum) || priceNum < 0)
        ) {
          errors.push({
            row: displayRow,
            column: 'sellingPrice',
            message: `sellingPrice must be a non-negative number (got '${rawPrice}')`,
          });
          hasError = true;
        } else {
          mappedRow.sellingPrice = isNaN(priceNum)
            ? (mappedRow.productRef?.price ?? 0)
            : priceNum;
        }

        // Base Price fallback
        const basePriceNum = Number(mappedRow.basePrice);
        // If the file does not explicitly provide a base/original price, the
        // safest historical value is the imported selling price. Product.price
        // is the menu's current price, not necessarily the price on this old
        // sale; using it here can create fake discounts or even negative
        // discounts when prices changed.
        mappedRow.basePrice =
          !isNaN(basePriceNum) && basePriceNum >= 0
            ? basePriceNum
            : mappedRow.sellingPrice;

        if (!hasError) {
          validRows.push(mappedRow);
        }
      } else {
        validRows.push(mappedRow);
      }
    });

    return { validRows, errors };
  }

  private splitCsvLines(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentCell);
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++; // Handle CRLF
        }
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }

    return rows;
  }
}
