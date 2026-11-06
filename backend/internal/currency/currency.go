package currency

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

type Currency string

const (
	Toman Currency = "TOMAN"
	Rial  Currency = "RIAL"

	// MaxSafeTomanAmount caps single monetary values at 999,999,999,999 Toman (~1 quadrillion Rial),
	// preventing int64 overflow during sums and 10x Rial reporting conversions.
	MaxSafeTomanAmount int64 = 999_999_999_999
	RialPerToman       int64 = 10
)

var (
	ErrNegativeAmount  = errors.New("monetary amount cannot be negative")
	ErrZeroAmount      = errors.New("monetary amount must be greater than zero")
	ErrAmountOverflow  = errors.New("monetary amount exceeds maximum safe Toman limit")
	ErrInvalidCurrency = errors.New("unsupported currency (must be TOMAN or RIAL)")
)

func ParseCurrency(input string) (Currency, error) {
	switch strings.ToUpper(strings.TrimSpace(input)) {
	case "", "TOMAN", "IRT", "تومان":
		return Toman, nil
	case "RIAL", "IRR", "ریال":
		return Rial, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidCurrency, input)
	}
}

func ValidateToman(amount int64, allowZero bool) error {
	if amount < 0 {
		return ErrNegativeAmount
	}
	if !allowZero && amount == 0 {
		return ErrZeroAmount
	}
	if amount > MaxSafeTomanAmount {
		return ErrAmountOverflow
	}
	return nil
}

// ConvertForDisplay converts a canonical Toman integer into the requested reporting currency
// (1 Toman = 10 Rial) without modifying stored data.
func ConvertForDisplay(tomanAmount int64, target Currency) (int64, error) {
	switch target {
	case Toman, "":
		return tomanAmount, nil
	case Rial:
		if tomanAmount > math.MaxInt64/RialPerToman || tomanAmount < math.MinInt64/RialPerToman {
			return 0, ErrAmountOverflow
		}
		return tomanAmount * RialPerToman, nil
	default:
		return 0, fmt.Errorf("%w: %q", ErrInvalidCurrency, target)
	}
}

func LabelPersian(c Currency) string {
	if c == Rial {
		return "ریال"
	}
	return "تومان"
}
