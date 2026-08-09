import { Test, TestingModule } from '@nestjs/testing';
import { CsvParsingService } from './csv-parsing.service';
import { ImportTypeEnum, IngredientUnitEnum } from 'src/Common/Types';
import { BadRequestException } from '@nestjs/common';

describe('CsvParsingService', () => {
  let service: CsvParsingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CsvParsingService],
    }).compile();

    service = module.get<CsvParsingService>(CsvParsingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseCsv', () => {
    it('should parse valid CSV buffer into headers and raw rows', () => {
      const csvText =
        'Date,Product,Quantity,Price\n2026-07-01,Croissant,10,15.5\n2026-07-02,Kanafeh,5,40.0';
      const result = service.parseCsv(Buffer.from(csvText));

      expect(result.headers).toEqual(['Date', 'Product', 'Quantity', 'Price']);
      expect(result.rawRows.length).toBe(2);
      expect(result.rawRows[0]).toEqual([
        '2026-07-01',
        'Croissant',
        '10',
        '15.5',
      ]);
    });

    it('should throw BadRequestException if CSV is empty', () => {
      expect(() => service.parseCsv('')).toThrow(BadRequestException);
    });
  });

  describe('autoSuggestMapping', () => {
    it('should auto-suggest mapping for menu_items', () => {
      const headers = ['Product Title', 'Selling Price', 'Freshness Days'];
      const mapping = service.autoSuggestMapping(
        headers,
        ImportTypeEnum.MENU_ITEMS,
      );
      expect(mapping.SellingPrice || mapping['Selling Price']).toBeDefined();
    });

    it('should auto-suggest mapping for ingredients', () => {
      const headers = ['Ingredient Name', 'Code', 'Unit', 'Shelf Life'];
      const mapping = service.autoSuggestMapping(
        headers,
        ImportTypeEnum.INGREDIENTS,
      );
      expect(mapping['Ingredient Name']).toBe('name');
      expect(mapping.Code).toBe('ingredientCode');
      expect(mapping.Unit).toBe('unit');
    });

    it('should auto-suggest mapping for recipes', () => {
      const headers = ['Product', 'Ingredient', 'Portion Qty'];
      const mapping = service.autoSuggestMapping(
        headers,
        ImportTypeEnum.RECIPES,
      );
      expect(mapping.Product).toBe('productId');
      expect(mapping.Ingredient).toBe('ingredientId');
      expect(mapping['Portion Qty']).toBe('quantityPerPortion');
    });

    it('should auto-suggest mapping for inventory_transactions', () => {
      const headers = ['Raw Material', 'Quantity', 'Batch Lot'];
      const mapping = service.autoSuggestMapping(
        headers,
        ImportTypeEnum.INVENTORY_TRANSACTIONS,
      );
      expect(mapping['Raw Material']).toBe('ingredientId');
      expect(mapping.Quantity).toBe('quantity');
      expect(mapping['Batch Lot']).toBe('batchNumber');
    });
  });

  describe('mapAndValidateRows', () => {
    const mockProducts = [
      { _id: '665f0a1b2c3d4e5f00000001', title: 'Croissant', price: 18 },
      { _id: '665f0a1b2c3d4e5f00000002', title: 'Kanafeh', price: 45 },
    ];

    const mockIngredients = [
      {
        _id: '665f0a1b2c3d4e5f00000099',
        ingredientCode: 'FLOUR-01',
        name: 'Flour',
        unit: IngredientUnitEnum.KG,
      },
    ];

    it('should validate menu_items rows', () => {
      const headers = ['Title', 'Price'];
      const mapping = { Title: 'title', Price: 'price' };
      const rawRows = [
        ['Baklava', '30'],
        ['', '-5'], // invalid
      ];

      const result = service.mapAndValidateRows(
        ImportTypeEnum.MENU_ITEMS,
        rawRows,
        headers,
        mapping,
      );
      expect(result.validRows.length).toBe(1);
      expect(result.validRows[0].title).toBe('Baklava');
      expect(result.validRows[0].price).toBe(30);
      expect(result.errors.length).toBe(2);
    });

    it('should validate ingredients rows and auto-generate code if missing', () => {
      const headers = ['Name', 'Code', 'Unit', 'Shelf Life'];
      const mapping = {
        Name: 'name',
        Code: 'ingredientCode',
        Unit: 'unit',
        'Shelf Life': 'shelfLifeDays',
      };
      const rawRows = [
        ['Sugar', 'SUGAR-01', 'kg', '60'],
        ['Butter', '', 'kg', '30'], // Code missing -> auto generated
        ['', 'NO-NAME', 'kg', '30'], // Name missing -> error
      ];

      const result = service.mapAndValidateRows(
        ImportTypeEnum.INGREDIENTS,
        rawRows,
        headers,
        mapping,
      );
      expect(result.validRows.length).toBe(2);
      expect(result.validRows[0].ingredientCode).toBe('SUGAR-01');
      expect(result.validRows[1].ingredientCode).toBe('BUTTER-01');
      expect(result.errors.length).toBe(1);
    });

    it('should validate recipe dependency constraints (product & ingredient existence)', () => {
      const headers = ['Product', 'Ingredient', 'Qty'];
      const mapping = {
        Product: 'productId',
        Ingredient: 'ingredientId',
        Qty: 'quantityPerPortion',
      };
      const rawRows = [
        ['Croissant', 'Flour', '0.2'], // valid
        ['UnknownProduct', 'Flour', '0.5'], // product missing error
        ['Croissant', 'UnknownIngredient', '0.1'], // ingredient missing error
      ];

      const result = service.mapAndValidateRows(
        ImportTypeEnum.RECIPES,
        rawRows,
        headers,
        mapping,
        mockProducts,
        mockIngredients,
      );

      expect(result.validRows.length).toBe(1);
      expect(result.validRows[0].quantityPerPortion).toBe(0.2);
      expect(result.errors.length).toBe(2);
      expect(
        result.errors.filter((e) =>
          e.message.includes('not found for this restaurant'),
        ).length,
      ).toBe(2);
    });

    it('should validate inventory_transactions rows and ingredient references', () => {
      const headers = ['Ingredient', 'Quantity', 'Batch'];
      const mapping = {
        Ingredient: 'ingredientId',
        Quantity: 'quantity',
        Batch: 'batchNumber',
      };
      const rawRows = [
        ['Flour', '50', 'BATCH-001'],
        ['NonExistent', '10', 'BATCH-002'],
      ];

      const result = service.mapAndValidateRows(
        ImportTypeEnum.INVENTORY_TRANSACTIONS,
        rawRows,
        headers,
        mapping,
        [],
        mockIngredients,
      );

      expect(result.validRows.length).toBe(1);
      expect(result.validRows[0].quantity).toBe(50);
      expect(result.validRows[0].unit).toBe(IngredientUnitEnum.KG);
      expect(result.errors.length).toBe(1);
    });

    it('should validate sales_history rows when products exist', () => {
      const headers = [
        'Date',
        'Product',
        'Quantity',
        'Production Qty',
        'Price',
      ];
      const mapping = {
        Date: 'date',
        Product: 'productId',
        Quantity: 'quantitySold',
        'Production Qty': 'productionQuantity',
        Price: 'sellingPrice',
      };
      const rawRows = [
        ['2026-07-01', 'Croissant', '10', '12', '18'],
        ['2026-07-02', 'Croissant', '0', '5', '18'], // zero is valid
        ['2026-07-03', 'Croissant', '5', '', '18'], // missing productionQuantity is invalid
        ['2026-07-04', 'Croissant', '-5', '10', '18'], // negative quantity is invalid
      ];

      const result = service.mapAndValidateRows(
        ImportTypeEnum.SALES_HISTORY,
        rawRows,
        headers,
        mapping,
        mockProducts,
      );

      expect(result.validRows.length).toBe(2);
      expect(result.validRows[0].quantitySold).toBe(10);
      expect(result.validRows[0].productionQuantity).toBe(12);
      expect(result.validRows[1].quantitySold).toBe(0);
      expect(result.validRows[1].productionQuantity).toBe(5);
      expect(result.errors.length).toBe(2);
      expect(
        result.errors.some((e) => e.column === 'productionQuantity'),
      ).toBe(true);
    });
  });
});
