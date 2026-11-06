package currency

import (
	"errors"
	"testing"
)

func TestValidateToman(t *testing.T) {
	if err := ValidateToman(4_250_000, false); err != nil {
		t.Fatalf("expected valid amount, got error: %v", err)
	}
	if err := ValidateToman(0, false); !errors.Is(err, ErrZeroAmount) {
		t.Fatalf("expected ErrZeroAmount for 0 when allowZero=false, got: %v", err)
	}
	if err := ValidateToman(0, true); err != nil {
		t.Fatalf("expected 0 to be allowed when allowZero=true, got: %v", err)
	}
	if err := ValidateToman(-500, true); !errors.Is(err, ErrNegativeAmount) {
		t.Fatalf("expected ErrNegativeAmount, got: %v", err)
	}
	if err := ValidateToman(MaxSafeTomanAmount+1, false); !errors.Is(err, ErrAmountOverflow) {
		t.Fatalf("expected ErrAmountOverflow, got: %v", err)
	}
}

func TestConvertForDisplay(t *testing.T) {
	toman := int64(2_500_000)

	gotToman, err := ConvertForDisplay(toman, Toman)
	if err != nil || gotToman != 2_500_000 {
		t.Fatalf("expected 2500000 Toman, got %d (err=%v)", gotToman, err)
	}

	gotRial, err := ConvertForDisplay(toman, Rial)
	if err != nil || gotRial != 25_000_000 {
		t.Fatalf("expected 25000000 Rial, got %d (err=%v)", gotRial, err)
	}
}
