package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

func validateDamageAmount(amount float64) model.ErrCode {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return model.ErrNumeric
	}
	return model.ErrOK
}

func applyDamageToHP(hpBefore float64, amount float64) (hpAfter float64, appliedDamage float64, code model.ErrCode) {
	if code := validateDamageAmount(amount); code != model.ErrOK {
		return hpBefore, 0, code
	}
	if hpBefore < 0 || math.IsNaN(hpBefore) || math.IsInf(hpBefore, 0) {
		return hpBefore, 0, model.ErrNumeric
	}
	hpAfter = hpBefore - amount
	if hpAfter < 0 {
		hpAfter = 0
	}
	return hpAfter, hpBefore - hpAfter, model.ErrOK
}

func mitigateDamageByResistance(amount float64, resistance float64, damageType string) (float64, model.ErrCode) {
	if code := validateDamageAmount(amount); code != model.ErrOK {
		return 0, code
	}
	if math.IsNaN(resistance) || math.IsInf(resistance, 0) {
		return 0, model.ErrNumeric
	}
	if damageType == "true" {
		return amount, model.ErrOK
	}
	if resistance >= 0 {
		return amount * 100 / (100 + resistance), model.ErrOK
	}
	return amount * (2 - 100/(100-resistance)), model.ErrOK
}
