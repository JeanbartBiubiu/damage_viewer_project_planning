package effect

import (
	"testing"
)

func TestSourceExpiryFactsCopyWithBagVersions(t *testing.T) {
	original := &bagData{}
	original.rearmSourceExpiry("wait", 500)
	branch := shareProviderStateMap(map[string]*bagData{"p": original})
	copy := writableProviderStateBag(branch, "p", false)
	copy.rearmSourceExpiry("wait", 900)
	if original.sourceExpiryFacts["wait"].Deadline != 500 || copy.sourceExpiryFacts["wait"].Deadline != 900 {
		t.Fatal("expiry fact changed another frame")
	}
}
