import { SalesTransactionRepository } from './sales-transaction.repository';

describe('SalesTransactionRepository', () => {
  function repoWithAggregateResult(result: any[]) {
    const exec = jest.fn().mockResolvedValue(result);
    const model: any = {
      aggregate: jest.fn().mockReturnValue({ exec }),
    };

    return {
      repo: new SalesTransactionRepository(model),
      model,
    };
  }

  it('summarizes discounts as positive markdowns and never negative', async () => {
    const { repo, model } = repoWithAggregateResult([
      {
        totalTransactions: 2,
        totalQuantitySold: 5,
        totalGrossRevenue: 125,
        totalNetRevenue: 115,
        totalDiscountsGiven: 10,
        promotionalSalesCount: 2,
        featuredSalesCount: 0,
      },
    ]);

    const summary = await repo.aggregateSalesSummary({ isDeleted: false });

    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $group: expect.objectContaining({
            totalGrossRevenue: {
              $sum: {
                $multiply: [
                  '$quantitySold',
                  { $max: ['$basePrice', '$sellingPrice'] },
                ],
              },
            },
            totalDiscountsGiven: {
              $sum: {
                $multiply: [
                  '$quantitySold',
                  {
                    $max: [{ $subtract: ['$basePrice', '$sellingPrice'] }, 0],
                  },
                ],
              },
            },
          }),
        }),
      ]),
    );
    expect(summary.totalGrossRevenue).toBe(125);
    expect(summary.totalNetRevenue).toBe(115);
    expect(summary.totalDiscountsGiven).toBe(10);
    expect(summary.averageSellingPrice).toBe(23);
  });
});
