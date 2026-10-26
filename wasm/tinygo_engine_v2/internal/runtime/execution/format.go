package execution

func itoa(value uint32) string {
	if value == 0 {
		return "0"
	}
	buf := [10]byte{}
	pos := len(buf)
	for value > 0 {
		pos--
		buf[pos] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[pos:])
}
