const compareRule = (value, rule) => {
    if (value === undefined) {
        return false;
    }
    switch (rule.operator) {
        case "gt":
            return Number(value) > Number(rule.value);
        case "gte":
            return Number(value) >= Number(rule.value);
        case "lt":
            return Number(value) < Number(rule.value);
        case "lte":
            return Number(value) <= Number(rule.value);
        case "eq":
            return String(value) === String(rule.value);
        case "between": {
            const [start, end] = rule.value;
            const numericValue = Number(value);
            return numericValue >= start && numericValue <= end;
        }
        default:
            return false;
    }
};
export const evaluateMethodDefinition = (definition, context) => {
    const reasons = [];
    for (const rule of definition.rules) {
        const contextValue = context[rule.key];
        const passed = compareRule(contextValue, rule);
        if (!passed) {
            return {
                shouldEnter: false,
                reason: [`Falhou na regra ${rule.key} ${rule.operator}`],
            };
        }
        reasons.push(`Regra aprovada: ${rule.key}`);
    }
    return {
        shouldEnter: true,
        reason: reasons,
    };
};
