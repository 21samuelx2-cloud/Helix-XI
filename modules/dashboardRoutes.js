async function getOnboardingContext(sb, user) {
  if (!user?.userId) return null;
  try {
    let query = sb.from('helixxi_onboarding').select('*');
    if (user.companyId) query = query.eq('company_id', user.companyId);
    else query = query.eq('user_id', user.userId);
    const { data } = await query.order('completed_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

async function saveOnboardingContext(sb, user, payload) {
  const ownershipFilter = user.companyId
    ? { column: 'company_id', value: user.companyId }
    : { column: 'user_id', value: user.userId };

  const { data: existing, error: existingError } = await sb
    .from('helixxi_onboarding')
    .select('id')
    .eq(ownershipFilter.column, ownershipFilter.value)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await sb
      .from('helixxi_onboarding')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await sb.from('helixxi_onboarding').insert(payload);
  if (error) throw error;
}

function buildVarianceEngine(posted, latestForecast, budgetContext = null) {
  const msInDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const currentWindowStart = new Date(now - (30 * msInDay));
  const previousWindowStart = new Date(now - (60 * msInDay));

  const rows = posted
    .map((row) => {
      const date = new Date(row.Date || row.date || 0);
      const amount = parseFloat(row.Amount || row.amount) || 0;
      return {
        date,
        amount,
        vendor: row.Vendor || row.vendor || 'Unknown',
        category: row.Category || row.category || 'Uncategorized',
        description: row.Description || row.description || '',
        hxfrs: parseFloat(row.HXFRS || row.hxfrs) || 0,
      };
    })
    .filter((row) => !isNaN(row.date) && row.amount > 0);

  const current = rows.filter((row) => row.date >= currentWindowStart);
  const previous = rows.filter((row) => row.date >= previousWindowStart && row.date < currentWindowStart);
  const trailing90Start = new Date(now - (90 * msInDay));
  const trailing90 = rows.filter((row) => row.date >= trailing90Start);

  const currentSpend = current.reduce((sum, row) => sum + row.amount, 0);
  const previousSpend = previous.reduce((sum, row) => sum + row.amount, 0);
  const netDelta = currentSpend - previousSpend;
  const deltaPct = previousSpend > 0 ? (netDelta / previousSpend) * 100 : null;
  const monthlyBudget = parseFloat(budgetContext?.monthly_budget || budgetContext?.monthlyBudget || 0) || 0;
  const planDelta = monthlyBudget > 0 ? currentSpend - monthlyBudget : null;
  const planDeltaPct = monthlyBudget > 0 ? ((currentSpend - monthlyBudget) / monthlyBudget) * 100 : null;

  const buildBudgetMix = () => {
    const source = trailing90.length > 0 ? trailing90 : previous.length > 0 ? previous : current;
    const totals = new Map();
    let spendTotal = 0;
    source.forEach((row) => {
      totals.set(row.category, (totals.get(row.category) || 0) + row.amount);
      spendTotal += row.amount;
    });
    if (spendTotal <= 0) {
      return [{ category: 'Uncategorized', weight: 1 }];
    }
    return [...totals.entries()]
      .map(([category, amount]) => ({ category, weight: amount / spendTotal }))
      .sort((a, b) => b.weight - a.weight);
  };

  const budgetMix = buildBudgetMix();
  const budgetByCategory = new Map(budgetMix.map((item) => [item.category, monthlyBudget * item.weight]));

  const computeDrivers = (dimension) => {
    const map = new Map();
    const add = (row, period) => {
      const key = row[dimension] || 'Unknown';
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          currentSpend: 0,
          previousSpend: 0,
          currentCount: 0,
          previousCount: 0,
          currentDescriptions: [],
          previousDescriptions: [],
          highRiskCount: 0,
        });
      }
      const entry = map.get(key);
      if (period === 'current') {
        entry.currentSpend += row.amount;
        entry.currentCount += 1;
        if (entry.currentDescriptions.length < 4 && row.description) entry.currentDescriptions.push(row.description);
      } else {
        entry.previousSpend += row.amount;
        entry.previousCount += 1;
        if (entry.previousDescriptions.length < 3 && row.description) entry.previousDescriptions.push(row.description);
      }
      if (row.hxfrs >= 60) entry.highRiskCount += 1;
    };

    current.forEach((row) => add(row, 'current'));
    previous.forEach((row) => add(row, 'previous'));

    return [...map.values()]
      .map((entry) => {
        const delta = entry.currentSpend - entry.previousSpend;
        const avgCurrent = entry.currentCount ? entry.currentSpend / entry.currentCount : 0;
        const avgPrevious = entry.previousCount ? entry.previousSpend / entry.previousCount : 0;
        const avgDeltaPct = avgPrevious > 0 ? ((avgCurrent - avgPrevious) / avgPrevious) * 100 : null;
        const shareOfDelta = netDelta !== 0 ? Math.abs(delta / netDelta) * 100 : 0;
        const plannedSpend = dimension === 'category' && monthlyBudget > 0 ? (budgetByCategory.get(entry.name) || 0) : null;
        const planGap = plannedSpend != null ? entry.currentSpend - plannedSpend : null;
        const planGapPct = plannedSpend != null && plannedSpend > 0 ? ((entry.currentSpend - plannedSpend) / plannedSpend) * 100 : null;

        let driverType = 'mixed';
        let reason = 'Activity shifted versus the prior 30 days.';
        if (entry.previousSpend === 0 && entry.currentSpend > 0) {
          driverType = 'new';
          reason = `New ${dimension} activity appeared this month and was absent in the prior period.`;
        } else if (entry.currentSpend === 0 && entry.previousSpend > 0) {
          driverType = 'drop';
          reason = `${dimension === 'vendor' ? 'Vendor' : 'Category'} spend fell out of the current period entirely.`;
        } else if (entry.currentCount > entry.previousCount && Math.abs(avgDeltaPct || 0) < 12) {
          driverType = 'volume';
          reason = 'The increase is mostly volume-driven: more transactions, not materially higher ticket size.';
        } else if ((avgDeltaPct || 0) >= 12 && entry.currentCount <= Math.max(entry.previousCount, 1) + 1) {
          driverType = 'price';
          reason = 'Average transaction size moved up sharply, which suggests pricing, renewal, or scope expansion.';
        } else if (delta > 0) {
          driverType = 'expansion';
          reason = 'Spend expanded materially relative to the prior month.';
        } else if (delta < 0) {
          driverType = 'contraction';
          reason = 'Spend contracted relative to the prior month.';
        }

        if (plannedSpend != null && planGapPct != null && Math.abs(planGapPct) >= 15) {
          reason = `${reason} It is also ${planGap >= 0 ? 'running above' : 'running below'} the current plan allocation by ${Math.abs(planGapPct).toFixed(0)}%.`;
        }

        return {
          ...entry,
          delta,
          deltaPct: entry.previousSpend > 0 ? ((delta / entry.previousSpend) * 100) : null,
          plannedSpend,
          planGap,
          planGapPct,
          avgCurrent,
          avgPrevious,
          avgDeltaPct,
          shareOfDelta: parseFloat(shareOfDelta.toFixed(1)),
          driverType,
          reason,
        };
      })
      .filter((entry) => entry.currentSpend > 0 || entry.previousSpend > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  };

  const categoryDrivers = computeDrivers('category');
  const vendorDrivers = computeDrivers('vendor');
  const primaryCategory = categoryDrivers[0] || null;
  const primaryVendor = vendorDrivers[0] || null;

  let primaryDriver = null;
  if (primaryCategory || primaryVendor) {
    const categoryStrength = Math.abs(primaryCategory?.delta || 0);
    const vendorStrength = Math.abs(primaryVendor?.delta || 0);
    primaryDriver = vendorStrength > categoryStrength * 1.15 ? primaryVendor : primaryCategory || primaryVendor;
  }

  const formatPct = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
  };

  const investigations = [];
  if (monthlyBudget > 0) {
    investigations.push({
      kind: 'plan',
      title: planDelta >= 0 ? 'Spend is running above monthly plan' : 'Spend is running below monthly plan',
      detail: `Actual posted spend is ${Math.abs(planDelta || 0).toFixed(0)} ${planDelta >= 0 ? 'above' : 'below'} the configured monthly budget of ${monthlyBudget.toFixed(0)}.`,
      why: 'This is the budget anchor ARIA can use today before dedicated budget uploads are added.',
      evidence: [
        `Monthly budget: ${monthlyBudget.toFixed(0)}`,
        `Actual last 30 days: ${currentSpend.toFixed(0)}`,
        planDeltaPct != null ? `Plan variance: ${formatPct(planDeltaPct)}` : null,
      ].filter(Boolean),
      nextAction: 'Validate whether the configured monthly budget is still the right plan baseline for this close.',
      target: 'why',
    });
  }
  if (primaryCategory) {
    investigations.push({
      kind: 'category',
      title: `${primaryCategory.name} is the main variance driver`,
      detail: `${primaryCategory.name} moved ${netDelta >= 0 ? 'up' : 'down'} by ${Math.abs(primaryCategory.delta).toFixed(0)} over the last 30 days.`,
      why: primaryCategory.reason,
      evidence: [
        `Current window: ${primaryCategory.currentCount} transaction${primaryCategory.currentCount === 1 ? '' : 's'} / ${primaryCategory.currentSpend.toFixed(0)}`,
        `Previous window: ${primaryCategory.previousCount} transaction${primaryCategory.previousCount === 1 ? '' : 's'} / ${primaryCategory.previousSpend.toFixed(0)}`,
        primaryCategory.avgDeltaPct != null ? `Avg ticket change: ${formatPct(primaryCategory.avgDeltaPct)}` : null,
      ].filter(Boolean),
      nextAction: 'Validate whether this category movement was planned, then map the owner behind it.',
      target: 'ledger',
    });
  }
  if (primaryVendor) {
    investigations.push({
      kind: 'vendor',
      title: `${primaryVendor.name} explains the largest vendor-level movement`,
      detail: `${primaryVendor.name} contributed ${Math.abs(primaryVendor.delta).toFixed(0)} of variance versus the prior 30-day window.`,
      why: primaryVendor.reason,
      evidence: [
        `Current spend: ${primaryVendor.currentSpend.toFixed(0)} across ${primaryVendor.currentCount} transaction${primaryVendor.currentCount === 1 ? '' : 's'}`,
        `Previous spend: ${primaryVendor.previousSpend.toFixed(0)} across ${primaryVendor.previousCount} transaction${primaryVendor.previousCount === 1 ? '' : 's'}`,
        primaryVendor.highRiskCount > 0 ? `${primaryVendor.highRiskCount} high-risk transaction${primaryVendor.highRiskCount === 1 ? '' : 's'} linked to this vendor` : null,
      ].filter(Boolean),
      nextAction: 'Pull the invoice, contract, or owner context for this vendor before the close narrative goes out.',
      target: 'ledger',
    });
  }
  if (latestForecast && (latestForecast.CashGapRisk === 'true' || latestForecast.cash_gap_risk === true)) {
    investigations.push({
      kind: 'forecast',
      title: 'This variance now matters to the forecast',
      detail: `The forecast stress case is already elevated at ${parseFloat(latestForecast.ModelC_Stress || latestForecast.model_c_stress || 0).toFixed(0)}.`,
      why: 'A variance is more dangerous when it rolls forward into an already tight cash profile.',
      evidence: [
        `30-day burn: ${parseFloat(latestForecast.MonthlyBurn || latestForecast.monthly_burn || 0).toFixed(0)}`,
        `90-day base case: ${parseFloat(latestForecast.ModelC_Base || latestForecast.model_c_base || 0).toFixed(0)}`,
      ],
      nextAction: 'Update the close narrative with forward impact, not just backward explanation.',
      target: 'forecast',
    });
  }

  const headline = primaryDriver
    ? `${primaryDriver.name} is driving the month-over-month variance`
    : 'ARIA needs more transaction history to attribute the variance';

  const narrativeParts = [];
  if (monthlyBudget > 0 && planDeltaPct != null) narrativeParts.push(`Against plan, posted spend is ${planDelta >= 0 ? 'over' : 'under'} budget by ${Math.abs(planDeltaPct).toFixed(0)}%.`);
  if (deltaPct != null) narrativeParts.push(`Posted spend is ${netDelta >= 0 ? 'up' : 'down'} ${Math.abs(deltaPct).toFixed(0)}% versus the previous 30 days.`);
  else if (currentSpend > 0) narrativeParts.push(`ARIA only has current-period activity so far, totaling ${currentSpend.toFixed(0)} in posted spend.`);
  if (primaryCategory) narrativeParts.push(`${primaryCategory.name} is the clearest category-level driver, moving by ${Math.abs(primaryCategory.delta).toFixed(0)}.`);
  if (primaryVendor) narrativeParts.push(`${primaryVendor.name} is the biggest vendor-level explanation behind the shift.`);
  if (latestForecast && (latestForecast.CashGapRisk === 'true' || latestForecast.cash_gap_risk === true)) {
    narrativeParts.push('Because the forecast already shows stress, this variance should be treated as forward-looking, not just historical.');
  }

  const boardNarrative = primaryDriver
    ? `Actual spend for the last 30 days came in at ${currentSpend.toFixed(0)}${monthlyBudget > 0 ? ` against a plan of ${monthlyBudget.toFixed(0)}` : ''}. ${monthlyBudget > 0 && planDelta != null ? `That is ${planDelta >= 0 ? 'an overspend' : 'an underspend'} of ${Math.abs(planDelta).toFixed(0)}.` : ''} Versus the prior 30-day period, spend ${netDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(netDelta).toFixed(0)}. The primary driver was ${primaryDriver.name}, which accounted for ${primaryDriver.shareOfDelta.toFixed(0)}% of the net movement. ARIA's read is that this was mainly ${primaryDriver.driverType === 'price' ? 'a pricing or renewal-size change' : primaryDriver.driverType === 'volume' ? 'a volume-driven shift in activity' : primaryDriver.driverType === 'new' ? 'new spend that did not exist in the prior month' : 'an operational mix change'} and should be validated with owner context before close.`
    : 'ARIA does not yet have enough clean posted history to produce a board-ready variance narrative.';

  const confidenceScore = Math.max(28, Math.min(96, (primaryDriver ? 38 : 10) + Math.min(current.length, 20) + (primaryCategory ? 12 : 0) + (primaryVendor ? 12 : 0) + (previous.length > 0 ? 16 : 0)));

  return {
    summary: {
      currentWindowSpend: parseFloat(currentSpend.toFixed(2)),
      previousWindowSpend: parseFloat(previousSpend.toFixed(2)),
      netDelta: parseFloat(netDelta.toFixed(2)),
      deltaPct: deltaPct == null ? null : parseFloat(deltaPct.toFixed(1)),
      plannedSpend: monthlyBudget > 0 ? parseFloat(monthlyBudget.toFixed(2)) : null,
      planDelta: planDelta == null ? null : parseFloat(planDelta.toFixed(2)),
      planDeltaPct: planDeltaPct == null ? null : parseFloat(planDeltaPct.toFixed(1)),
      confidenceScore,
    },
    headline,
    narrative: narrativeParts.join(' '),
    boardNarrative,
    primaryDriver: primaryDriver ? {
      name: primaryDriver.name,
      dimension: primaryDriver === primaryVendor ? 'vendor' : 'category',
      driverType: primaryDriver.driverType,
      delta: parseFloat(primaryDriver.delta.toFixed(2)),
      shareOfDelta: primaryDriver.shareOfDelta,
      reason: primaryDriver.reason,
    } : null,
    categoryDrivers: categoryDrivers.slice(0, 5).map((item) => ({
      name: item.name,
      delta: parseFloat(item.delta.toFixed(2)),
      deltaPct: item.deltaPct == null ? null : parseFloat(item.deltaPct.toFixed(1)),
      currentSpend: parseFloat(item.currentSpend.toFixed(2)),
      previousSpend: parseFloat(item.previousSpend.toFixed(2)),
      plannedSpend: item.plannedSpend == null ? null : parseFloat(item.plannedSpend.toFixed(2)),
      planGap: item.planGap == null ? null : parseFloat(item.planGap.toFixed(2)),
      planGapPct: item.planGapPct == null ? null : parseFloat(item.planGapPct.toFixed(1)),
      shareOfDelta: item.shareOfDelta,
      driverType: item.driverType,
      reason: item.reason,
    })),
    vendorDrivers: vendorDrivers.slice(0, 5).map((item) => ({
      name: item.name,
      delta: parseFloat(item.delta.toFixed(2)),
      deltaPct: item.deltaPct == null ? null : parseFloat(item.deltaPct.toFixed(1)),
      currentSpend: parseFloat(item.currentSpend.toFixed(2)),
      previousSpend: parseFloat(item.previousSpend.toFixed(2)),
      shareOfDelta: item.shareOfDelta,
      driverType: item.driverType,
      reason: item.reason,
    })),
    investigations: investigations.slice(0, 4),
  };
}

function buildFinanceIntelligence(ledger, holdQueue, forecasts, budgetContext = null) {
  const posted = ledger.filter((r) => (r.Status || r.status) === 'POSTED');
  const held = holdQueue.filter((r) => (r.Status || r.status) === 'PENDING_CFO_REVIEW');
  const approved = holdQueue.filter((r) => (r.Status || r.status) === 'APPROVED');
  const rejected = holdQueue.filter((r) => (r.Status || r.status) === 'REJECTED');

  const totalSpend = posted.reduce((s, r) => s + (parseFloat(r.Amount || r.amount) || 0), 0);
  const avgFraud = ledger.length
    ? ledger.reduce((s, r) => s + (parseFloat(r.HXFRS || r.hxfrs) || 0), 0) / ledger.length
    : 0;
  const latestForecast = forecasts.length ? forecasts[forecasts.length - 1] : null;
  const varianceEngine = buildVarianceEngine(posted, latestForecast, budgetContext);

  const now = Date.now();
  const last30 = posted.filter((r) => {
    const d = new Date(r.Date || r.date || 0);
    return !isNaN(d) && (now - d.getTime()) <= 30 * 24 * 60 * 60 * 1000;
  });
  const monthlyBurn = last30.reduce((s, r) => s + (parseFloat(r.Amount || r.amount) || 0), 0);

  const catSpend = {};
  posted.forEach((r) => {
    const c = r.Category || r.category || 'Uncategorized';
    catSpend[c] = (catSpend[c] || 0) + (parseFloat(r.Amount || r.amount) || 0);
  });
  const topCategories = Object.entries(catSpend)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  const monthlyData = {};
  posted.forEach((r) => {
    const d = new Date(r.Date || r.date || 0);
    if (isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = (monthlyData[key] || 0) + (parseFloat(r.Amount || r.amount) || 0);
  });
  const spendTrend = Object.entries(monthlyData).sort().slice(-6)
    .map(([month, spend]) => ({ month, spend: parseFloat(spend.toFixed(2)) }));

  const highRisk = ledger.filter((r) => (parseFloat(r.HXFRS || r.hxfrs) || 0) >= 60).length;
  const fraudRate = ledger.length ? ((highRisk / ledger.length) * 100).toFixed(1) : 0;

  const vendorSpend = {};
  posted.forEach((r) => {
    const v = r.Vendor || r.vendor || 'Unknown';
    vendorSpend[v] = (vendorSpend[v] || 0) + (parseFloat(r.Amount || r.amount) || 0);
  });
  const topVendors = Object.entries(vendorSpend)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  const recentPosted = posted
    .map((row) => ({
      amount: parseFloat(row.Amount || row.amount) || 0,
      vendor: row.Vendor || row.vendor || 'Unknown',
      category: row.Category || row.category || 'Uncategorized',
      date: new Date(row.Date || row.date || 0),
    }))
    .filter((row) => !isNaN(row.date));

  const nowDate = new Date();
  const msInDay = 24 * 60 * 60 * 1000;
  const currentWindowStart = new Date(nowDate.getTime() - (7 * msInDay));
  const previousWindowStart = new Date(nowDate.getTime() - (14 * msInDay));
  const currentWeek = recentPosted.filter((row) => row.date >= currentWindowStart);
  const previousWeek = recentPosted.filter((row) => row.date >= previousWindowStart && row.date < currentWindowStart);
  const currentWeekSpend = currentWeek.reduce((sum, row) => sum + row.amount, 0);
  const previousWeekSpend = previousWeek.reduce((sum, row) => sum + row.amount, 0);
  const spendDelta = currentWeekSpend - previousWeekSpend;
  const spendDeltaPct = previousWeekSpend > 0 ? ((spendDelta / previousWeekSpend) * 100) : null;

  const categoryDeltaMap = new Map();
  currentWeek.forEach((row) => categoryDeltaMap.set(row.category, (categoryDeltaMap.get(row.category) || 0) + row.amount));
  previousWeek.forEach((row) => categoryDeltaMap.set(row.category, (categoryDeltaMap.get(row.category) || 0) - row.amount));
  const topCategoryShift = [...categoryDeltaMap.entries()]
    .map(([category, delta]) => ({ category, delta }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null;

  const actionableAlerts = [];
  if (held.length > 0) {
    actionableAlerts.push({
      level: held.length >= 3 ? 'high' : 'medium',
      title: `${held.length} transaction${held.length === 1 ? '' : 's'} need review`,
      detail: held.length >= 3 ? 'The hold queue is building up and needs CFO attention.' : 'ARIA is waiting on a decision for a flagged transaction.',
      action: 'Open Hold Queue',
      target: 'holds',
    });
  }
  if (latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true) {
    actionableAlerts.push({
      level: 'high',
      title: 'Cash gap risk detected',
      detail: `Stress case forecast is at ${parseFloat(latestForecast?.ModelC_Stress || latestForecast?.model_c_stress || 0).toFixed(0)}.`,
      action: 'Open Forecast',
      target: 'forecast',
    });
  }
  if (typeof spendDeltaPct === 'number' && Math.abs(spendDeltaPct) >= 20) {
    actionableAlerts.push({
      level: spendDeltaPct > 0 ? 'medium' : 'low',
      title: spendDeltaPct > 0 ? 'Spend is rising fast this week' : 'Spend dropped sharply this week',
      detail: `${Math.abs(spendDeltaPct).toFixed(0)}% ${spendDeltaPct > 0 ? 'increase' : 'decrease'} versus the prior 7 days.`,
      action: 'View Dashboard',
      target: 'dashboard',
    });
  }

  const highestRiskTx = [...ledger]
    .map((row) => ({
      score: parseFloat(row.HXFRS || row.hxfrs) || 0,
      vendor: row.Vendor || row.vendor || 'Unknown',
      amount: parseFloat(row.Amount || row.amount) || 0,
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (highestRiskTx && highestRiskTx.score >= 85) {
    actionableAlerts.push({
      level: 'high',
      title: `High-risk activity spotted at ${highestRiskTx.vendor}`,
      detail: `Highest fraud score in the ledger is ${highestRiskTx.score}/100 on ${highestRiskTx.amount.toFixed(0)} spend.`,
      action: 'View Ledger',
      target: 'ledger',
    });
  }

  const briefLines = [];
  briefLines.push(`ARIA processed ${ledger.length} transactions so far, with ${held.length} currently waiting for review.`);
  if (varianceEngine?.primaryDriver?.name) briefLines.push(`The clearest month-over-month explanation right now is ${varianceEngine.primaryDriver.name}, which is driving the variance picture.`);
  if (typeof spendDeltaPct === 'number') briefLines.push(`Spend over the last 7 days is ${spendDeltaPct >= 0 ? 'up' : 'down'} ${Math.abs(spendDeltaPct).toFixed(0)}% compared with the previous week.`);
  else if (currentWeekSpend > 0) briefLines.push(`ARIA has ${currentWeek.length} posted transactions in the last 7 days worth ${currentWeekSpend.toFixed(0)} total.`);
  if (topCategoryShift && Math.abs(topCategoryShift.delta) > 0) briefLines.push(`${topCategoryShift.category} is the biggest recent swing, moving ${topCategoryShift.delta >= 0 ? 'up' : 'down'} by ${Math.abs(topCategoryShift.delta).toFixed(0)}.`);
  if (latestForecast) {
    const stressValue = parseFloat(latestForecast?.ModelC_Stress || latestForecast?.model_c_stress || 0);
    briefLines.push(`Forecast pressure is ${latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true ? 'elevated' : 'stable'}, with the 90-day stress case at ${stressValue.toFixed(0)}.`);
  }

  if (varianceEngine?.primaryDriver?.name && Math.abs(varianceEngine?.summary?.deltaPct || 0) >= 10) {
    actionableAlerts.unshift({
      level: Math.abs(varianceEngine.summary.deltaPct) >= 25 ? 'high' : 'medium',
      title: varianceEngine.headline,
      detail: varianceEngine.narrative,
      action: 'Open Why Engine',
      target: 'why',
    });
  }

  const proactiveSignals = [];
  if (held.length > 0) {
    proactiveSignals.push({
      score: Math.min(98, 60 + held.length * 8),
      level: held.length >= 3 ? 'high' : 'medium',
      title: 'Decision backlog is building',
      summary: `${held.length} transaction${held.length === 1 ? '' : 's'} are waiting in the hold queue.`,
      why: held.length >= 3 ? 'Approvals are stacking up, which slows cash movement and leaves more uncertainty in the system.' : 'A flagged transaction still needs review before ARIA can close the loop.',
      nextAction: 'Review the hold queue and clear the oldest item first.',
      action: 'Open Hold Queue',
      target: 'holds',
    });
  }
  if (typeof spendDeltaPct === 'number' && spendDeltaPct >= 20) {
    proactiveSignals.push({
      score: Math.min(95, 58 + Math.round(Math.abs(spendDeltaPct))),
      level: spendDeltaPct >= 35 ? 'high' : 'medium',
      title: 'Weekly spend acceleration detected',
      summary: `Posted spend is up ${Math.abs(spendDeltaPct).toFixed(0)}% versus the previous 7 days.`,
      why: topCategoryShift ? `${topCategoryShift.category} is the biggest driver of the increase right now.` : 'The recent spend curve is materially above the prior week.',
      nextAction: 'Check the spend trend and confirm whether the rise is planned or temporary.',
      action: 'Open Dashboard',
      target: 'dashboard',
    });
  }
  if (typeof spendDeltaPct === 'number' && spendDeltaPct <= -20) {
    proactiveSignals.push({
      score: 52,
      level: 'low',
      title: 'Spend dropped sharply this week',
      summary: `Posted spend is down ${Math.abs(spendDeltaPct).toFixed(0)}% versus the previous 7 days.`,
      why: 'A sudden drop can be healthy, but it can also mean delayed bills or missing activity.',
      nextAction: 'Confirm whether payments shifted or whether this was intentional.',
      action: 'View Ledger',
      target: 'ledger',
    });
  }
  if (latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true) {
    proactiveSignals.push({
      score: 92,
      level: 'high',
      title: 'Forecast stress case needs attention',
      summary: `The 90-day stress case sits at ${parseFloat(latestForecast?.ModelC_Stress || latestForecast?.model_c_stress || 0).toFixed(0)}.`,
      why: 'Cash pressure is elevated under downside conditions, so near-term spending decisions matter more.',
      nextAction: 'Open forecast, review the stress scenario, and decide where to tighten spend.',
      action: 'Open Forecast',
      target: 'forecast',
    });
  }
  if (highestRiskTx && highestRiskTx.score >= 85) {
    proactiveSignals.push({
      score: Math.min(99, highestRiskTx.score),
      level: 'high',
      title: `Extreme fraud risk on ${highestRiskTx.vendor}`,
      summary: `ARIA sees a ${highestRiskTx.score}/100 risk score on ${highestRiskTx.amount.toFixed(0)} of spend.`,
      why: 'This is the sharpest outlier in the current ledger and deserves human review.',
      nextAction: 'Open the ledger or hold queue and validate the vendor and payment context.',
      action: 'View Ledger',
      target: 'ledger',
    });
  }
  if (topVendors[0]) {
    proactiveSignals.push({
      score: 48,
      level: 'low',
      title: `${topVendors[0].name} is your top vendor`,
      summary: `${topVendors[0].name} accounts for ${topVendors[0].value.toFixed(0)} in posted spend.`,
      why: 'Concentration risk increases when one vendor dominates too much of the expense base.',
      nextAction: 'Check whether this vendor concentration is expected and still worth the cost.',
      action: 'View Dashboard',
      target: 'dashboard',
    });
  }
  proactiveSignals.sort((a, b) => b.score - a.score);

  const initiativeSignal = proactiveSignals.find((signal) => signal.score >= 85) || null;
  const initiative = initiativeSignal
    ? {
        signature: `${initiativeSignal.title}|${initiativeSignal.score}|${initiativeSignal.target}`,
        title: initiativeSignal.title,
        message: `I need your attention on one thing: ${initiativeSignal.summary} ${initiativeSignal.why} ${initiativeSignal.nextAction}`,
        action: initiativeSignal.action,
        target: initiativeSignal.target,
        score: initiativeSignal.score,
      }
    : null;

  const varianceWorkspace = varianceEngine
    ? {
        executiveSummary: {
          title: varianceEngine.headline,
          summary: varianceEngine.narrative,
          boardNarrative: varianceEngine.boardNarrative,
          confidenceScore: varianceEngine.summary?.confidenceScore || 0,
          actual: varianceEngine.summary?.currentWindowSpend || 0,
          plan: varianceEngine.summary?.plannedSpend || 0,
          variance: varianceEngine.summary?.planDelta || 0,
          variancePct: varianceEngine.summary?.planDeltaPct,
          priorPeriod: varianceEngine.summary?.previousWindowSpend || 0,
        },
        primaryQuestion: varianceEngine.primaryDriver ? `Why did ${varianceEngine.primaryDriver.name} move so sharply against plan?` : 'What changed in the business enough to move the close?',
        decisionQueue: [
          varianceEngine.primaryDriver ? {
            label: 'Validate primary driver',
            detail: `${varianceEngine.primaryDriver.name} is the first thing to confirm before the close narrative goes out.`,
            target: varianceEngine.primaryDriver.dimension === 'vendor' ? 'ledger' : 'why',
            urgency: 'high',
          } : null,
          varianceEngine.summary?.planDeltaPct != null && Math.abs(varianceEngine.summary.planDeltaPct) >= 10 ? {
            label: 'Explain the plan miss',
            detail: `ARIA sees the business ${varianceEngine.summary.planDelta >= 0 ? 'over' : 'under'} plan by ${Math.abs(varianceEngine.summary.planDeltaPct).toFixed(0)}%.`,
            target: 'why',
            urgency: Math.abs(varianceEngine.summary.planDeltaPct) >= 20 ? 'high' : 'medium',
          } : null,
          latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true ? {
            label: 'Reflect forward impact',
            detail: 'This variance already matters to the forecast and should be carried into the next outlook update.',
            target: 'forecast',
            urgency: 'high',
          } : null,
          held.length > 0 ? {
            label: 'Clear review backlog',
            detail: `${held.length} held transaction${held.length === 1 ? '' : 's'} could distort the operating picture until reviewed.`,
            target: 'holds',
            urgency: held.length >= 3 ? 'high' : 'medium',
          } : null,
        ].filter(Boolean),
        focusAreas: [
          ...(varianceEngine.categoryDrivers || []).slice(0, 3).map((driver) => ({
            kind: 'category',
            name: driver.name,
            driverType: driver.driverType,
            actual: driver.currentSpend,
            plan: driver.plannedSpend,
            variance: driver.planGap,
            variancePct: driver.planGapPct,
            prior: driver.previousSpend,
            reason: driver.reason,
          })),
          ...(varianceEngine.vendorDrivers || []).slice(0, 2).map((driver) => ({
            kind: 'vendor',
            name: driver.name,
            driverType: driver.driverType,
            actual: driver.currentSpend,
            prior: driver.previousSpend,
            variance: driver.delta,
            variancePct: driver.deltaPct,
            reason: driver.reason,
          })),
        ],
        operatingNarrative: [
          varianceEngine.summary?.planDeltaPct != null ? `Plan signal: the business is ${varianceEngine.summary.planDelta >= 0 ? 'over' : 'under'} plan by ${Math.abs(varianceEngine.summary.planDeltaPct).toFixed(0)}%.` : null,
          varianceEngine.primaryDriver ? `Root cause signal: ${varianceEngine.primaryDriver.name} is the clearest explanation ARIA has right now.` : null,
          topVendors[0] ? `Concentration signal: ${topVendors[0].name} is still the largest vendor in the spend base.` : null,
          latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true ? 'Forward signal: downside cash pressure is elevated, so this close narrative should influence the next spend decision.' : null,
        ].filter(Boolean),
      }
    : null;

  return {
    summary: {
      totalTransactions: ledger.length,
      totalSpend: parseFloat(totalSpend.toFixed(2)),
      monthlyBurn: parseFloat(monthlyBurn.toFixed(2)),
      avgFraudScore: parseFloat(avgFraud.toFixed(1)),
      fraudRate: parseFloat(fraudRate),
      heldCount: held.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      cashGapRisk: latestForecast?.CashGapRisk === 'true' || latestForecast?.cash_gap_risk === true,
      forecast90Base: parseFloat(latestForecast?.ModelC_Base || latestForecast?.model_c_base || 0),
      forecast90Stress: parseFloat(latestForecast?.ModelC_Stress || latestForecast?.model_c_stress || 0),
    },
    dailyBrief: {
      headline: actionableAlerts[0]?.title || 'Systems look stable right now',
      narrative: briefLines.join(' '),
      priorities: actionableAlerts.slice(0, 3).map((alert) => alert.title),
    },
    varianceEngine,
    varianceWorkspace,
    alerts: actionableAlerts,
    proactiveSignals: proactiveSignals.slice(0, 5),
    initiative,
    topCategories,
    spendTrend,
    topVendors,
  };
}

function registerDashboardRoutes(app, deps) {
  const { csrfGuard, getAuditLog, getForecasts, getHoldQueue, getLedger, jwtAuth, requirePermission, sb } = deps;

  app.get('/api/dashboard/kpis', jwtAuth, requirePermission('dashboard.read'), async (req, res) => {
    try {
      const [ledger, holdQueue, forecasts, budgetContext] = await Promise.all([
        getLedger(req.user.companyId),
        getHoldQueue(req.user.companyId),
        getForecasts(req.user.companyId),
        getOnboardingContext(sb, req.user),
      ]);
      res.json(buildFinanceIntelligence(ledger, holdQueue, forecasts, budgetContext));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dashboard', jwtAuth, requirePermission('dashboard.read'), async (req, res) => {
    try {
      const [ledger, holdQueue, forecasts, auditLog] = await Promise.all([
        getLedger(req.user.companyId),
        getHoldQueue(req.user.companyId),
        getForecasts(req.user.companyId),
        getAuditLog(req.user.companyId),
      ]);
      const totalVolume = ledger.reduce((s, t) => s + (parseFloat(t.Amount) || 0), 0);
      const avgFraudScore = ledger.length > 0 ? ledger.reduce((s, t) => s + (parseFloat(t.HXFRS) || 0), 0) / ledger.length : 0;
      const latestForecast = forecasts[forecasts.length - 1] || null;
      const pending = holdQueue.filter((t) => t.Status === 'PENDING_CFO_REVIEW');

      res.json({
        kpis: {
          totalTransactions: ledger.length,
          heldTransactions: pending.length,
          totalVolume: totalVolume.toFixed(2),
          avgFraudScore: avgFraudScore.toFixed(1),
          cashGapRisk: latestForecast?.CashGapRisk === 'true',
        },
        recentTransactions: ledger.slice(-10).reverse(),
        holdQueue: pending,
        latestForecast,
        recentAuditLog: auditLog.slice(-20).reverse(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/onboarding', csrfGuard, jwtAuth, async (req, res) => {
    try {
      const {
        companyName, industry, baseCurrency, monthlyBudget, openingCashBalance,
        paymentProcessor, cfoEmail, businessDescription, mainVendors, biggestConcern, normalMonth,
      } = req.body;
      await saveOnboardingContext(sb, req.user, {
        user_id: req.user.userId,
        company_id: req.user.companyId || null,
        company_name: companyName,
        industry,
        base_currency: baseCurrency,
        monthly_budget: monthlyBudget,
        opening_cash_balance: openingCashBalance,
        payment_processor: paymentProcessor,
        cfo_email: cfoEmail,
        business_description: businessDescription,
        main_vendors: mainVendors,
        biggest_concern: biggestConcern,
        normal_month: normalMonth,
        completed_at: new Date().toISOString(),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/onboarding', jwtAuth, async (req, res) => {
    try {
      const data = await getOnboardingContext(sb, req.user);
      res.json({ completed: !!data, data });
    } catch {
      res.json({ completed: false, data: null });
    }
  });
}

module.exports = {
  buildFinanceIntelligence,
  getOnboardingContext,
  registerDashboardRoutes,
};
