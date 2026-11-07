export async function updateExpense(
  id: string,
  updates: {
    title: string;
    category: string;
    amount: number;
    expenseDate: string;
    notes?: string;
  }
): Promise<Expense> {
  const cleanTitle = updates.title.trim();
  if (!cleanTitle) {
    throw new Error('عنوان هزینه الزامی است.');
  }
  if (!(updates.amount > 0)) {
    throw new Error('مبلغ هزینه باید بزرگ‌تر از صفر باشد.');
  }

  let updatedExpense!: Expense;

  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['expenses'].get(id)
    )) as Expense | undefined;
    if (!existing) {
      throw new Error('ردیف هزینه مورد نظر یافت نشد.');
    }

    updatedExpense = {
      ...existing,
      title: cleanTitle,
      category: updates.category.trim() || existing.category,
      amount: Math.round(updates.amount),
      expenseDate: updates.expenseDate || existing.expenseDate,
      notes: updates.notes?.trim() || undefined,
      isDemo: false
    };

    await requestToPromise(stores['expenses'].put(updatedExpense));
  });

  await loadPurchases(false);
  void syncLocalStateToServer(`ویرایش هزینه: ${updatedExpense.title}`);
  return updatedExpense;
}

export async function deleteExpense(id: string): Promise<void> {
  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    await requestToPromise(stores['expenses'].delete(id));
  });

  await loadPurchases(false);
  void syncLocalStateToServer('حذف ردیف هزینه');
}
