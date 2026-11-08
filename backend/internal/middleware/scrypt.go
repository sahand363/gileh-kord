package middleware

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/bits"
	"strconv"
	"strings"
)

const (
	ScryptDefaultN      = 16384
	ScryptDefaultR      = 8
	ScryptDefaultP      = 1
	ScryptDefaultKeyLen = 64
)

// HashPasswordScrypt hashes a plaintext password with a unique 16-byte cryptographic salt
// using RFC 7914 scrypt, returning "scrypt$16384$8$1$<salt_hex>$<dk_hex>".
func HashPasswordScrypt(password string) (string, error) {
	if len(password) == 0 {
		return "", errors.New("password cannot be empty")
	}
	var salt [16]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return "", err
	}
	dk, err := scryptDeriveKey([]byte(password), salt[:], ScryptDefaultN, ScryptDefaultR, ScryptDefaultP, ScryptDefaultKeyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("scrypt$%d$%d$%d$%s$%s",
		ScryptDefaultN, ScryptDefaultR, ScryptDefaultP,
		hex.EncodeToString(salt[:]),
		hex.EncodeToString(dk),
	), nil
}

// VerifyPasswordScrypt verifies a plaintext password against a stored "scrypt$N$r$p$salt$hash" record in constant time.
func VerifyPasswordScrypt(password, storedHash string) bool {
	parts := strings.Split(strings.TrimSpace(storedHash), "$")
	if len(parts) != 6 || parts[0] != "scrypt" {
		return false
	}
	N, err1 := strconv.Atoi(parts[1])
	r, err2 := strconv.Atoi(parts[2])
	p, err3 := strconv.Atoi(parts[3])
	if err1 != nil || err2 != nil || err3 != nil {
		return false
	}
	salt, err4 := hex.DecodeString(parts[4])
	expectedDK, err5 := hex.DecodeString(parts[5])
	if err4 != nil || err5 != nil || len(salt) < 8 || len(expectedDK) < 32 {
		return false
	}
	derived, err := scryptDeriveKey([]byte(password), salt, N, r, p, len(expectedDK))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(derived, expectedDK) == 1
}

// RFC 7914 scrypt implementation using standard library crypto/hmac & crypto/sha256
func scryptDeriveKey(password, salt []byte, N, r, p, keyLen int) ([]byte, error) {
	if N <= 1 || N&(N-1) != 0 || r <= 0 || p <= 0 || keyLen <= 0 || r*p >= (1<<30) {
		return nil, errors.New("invalid scrypt parameters")
	}
	b := pbkdf2SHA256(password, salt, p*128*r)
	xy := make([]uint32, 64*r)
	v := make([]uint32, 32*N*r)
	for i := 0; i < p; i++ {
		smix(b[i*128*r:(i+1)*128*r], r, N, v, xy)
	}
	return pbkdf2SHA256(password, b, keyLen), nil
}

func pbkdf2SHA256(password, salt []byte, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	numBlocks := (keyLen + hashLen - 1) / hashLen
	var buf [4]byte
	dk := make([]byte, 0, numBlocks*hashLen)
	for block := 1; block <= numBlocks; block++ {
		prf.Reset()
		prf.Write(salt)
		binary.BigEndian.PutUint32(buf[:], uint32(block))
		prf.Write(buf[:])
		dk = prf.Sum(dk)
	}
	return dk[:keyLen]
}

func smix(b []byte, r, N int, v, xy []uint32) {
	var tmp [16]uint32
	x := xy[:32*r]
	y := xy[32*r:]

	j := 0
	for i := 0; i < 32*r; i++ {
		x[i] = binary.LittleEndian.Uint32(b[j : j+4])
		j += 4
	}
	for i := 0; i < N; i += 2 {
		copy(v[i*(32*r):], x)
		blockMix(&tmp, x, y, r)

		copy(v[(i+1)*(32*r):], y)
		blockMix(&tmp, y, x, r)
	}
	for i := 0; i < N; i += 2 {
		k := int(x[(2*r-1)*16]) & (N - 1)
		xorBlocks(x, v[k*(32*r):])
		blockMix(&tmp, x, y, r)

		k = int(y[(2*r-1)*16]) & (N - 1)
		xorBlocks(y, v[k*(32*r):])
		blockMix(&tmp, y, x, r)
	}
	j = 0
	for _, xi := range x {
		binary.LittleEndian.PutUint32(b[j:j+4], xi)
		j += 4
	}
}

func blockMix(tmp *[16]uint32, in, out []uint32, r int) {
	copy(tmp[:], in[(2*r-1)*16:])
	for i := 0; i < 2*r; i += 2 {
		salsaXOR(tmp, in[i*16:], out[i*8:])
		salsaXOR(tmp, in[i*16+16:], out[i*8+r*16:])
	}
}

func salsaXOR(tmp *[16]uint32, in, out []uint32) {
	w0 := tmp[0] ^ in[0]
	w1 := tmp[1] ^ in[1]
	w2 := tmp[2] ^ in[2]
	w3 := tmp[3] ^ in[3]
	w4 := tmp[4] ^ in[4]
	w5 := tmp[5] ^ in[5]
	w6 := tmp[6] ^ in[6]
	w7 := tmp[7] ^ in[7]
	w8 := tmp[8] ^ in[8]
	w9 := tmp[9] ^ in[9]
	w10 := tmp[10] ^ in[10]
	w11 := tmp[11] ^ in[11]
	w12 := tmp[12] ^ in[12]
	w13 := tmp[13] ^ in[13]
	w14 := tmp[14] ^ in[14]
	w15 := tmp[15] ^ in[15]

	x0, x1, x2, x3, x4, x5, x6, x7 := w0, w1, w2, w3, w4, w5, w6, w7
	x8, x9, x10, x11, x12, x13, x14, x15 := w8, w9, w10, w11, w12, w13, w14, w15

	for i := 0; i < 8; i += 2 {
		x4 ^= bits.RotateLeft32(x0+x12, 7)
		x8 ^= bits.RotateLeft32(x4+x0, 9)
		x12 ^= bits.RotateLeft32(x8+x4, 13)
		x0 ^= bits.RotateLeft32(x12+x8, 18)

		x9 ^= bits.RotateLeft32(x5+x1, 7)
		x13 ^= bits.RotateLeft32(x9+x5, 9)
		x1 ^= bits.RotateLeft32(x13+x9, 13)
		x5 ^= bits.RotateLeft32(x1+x13, 18)

		x14 ^= bits.RotateLeft32(x10+x6, 7)
		x2 ^= bits.RotateLeft32(x14+x10, 9)
		x6 ^= bits.RotateLeft32(x2+x14, 13)
		x10 ^= bits.RotateLeft32(x6+x2, 18)

		x3 ^= bits.RotateLeft32(x15+x11, 7)
		x7 ^= bits.RotateLeft32(x3+x15, 9)
		x11 ^= bits.RotateLeft32(x7+x3, 13)
		x15 ^= bits.RotateLeft32(x11+x7, 18)

		x1 ^= bits.RotateLeft32(x0+x3, 7)
		x2 ^= bits.RotateLeft32(x1+x0, 9)
		x3 ^= bits.RotateLeft32(x2+x1, 13)
		x0 ^= bits.RotateLeft32(x3+x2, 18)

		x6 ^= bits.RotateLeft32(x5+x4, 7)
		x7 ^= bits.RotateLeft32(x6+x5, 9)
		x4 ^= bits.RotateLeft32(x7+x6, 13)
		x5 ^= bits.RotateLeft32(x4+x7, 18)

		x11 ^= bits.RotateLeft32(x10+x9, 7)
		x8 ^= bits.RotateLeft32(x11+x10, 9)
		x9 ^= bits.RotateLeft32(x8+x11, 13)
		x10 ^= bits.RotateLeft32(x9+x8, 18)

		x12 ^= bits.RotateLeft32(x15+x14, 7)
		x13 ^= bits.RotateLeft32(x12+x15, 9)
		x14 ^= bits.RotateLeft32(x13+x12, 13)
		x15 ^= bits.RotateLeft32(x14+x13, 18)
	}

	x0 += w0
	x1 += w1
	x2 += w2
	x3 += w3
	x4 += w4
	x5 += w5
	x6 += w6
	x7 += w7
	x8 += w8
	x9 += w9
	x10 += w10
	x11 += w11
	x12 += w12
	x13 += w13
	x14 += w14
	x15 += w15

	out[0], tmp[0] = x0, x0
	out[1], tmp[1] = x1, x1
	out[2], tmp[2] = x2, x2
	out[3], tmp[3] = x3, x3
	out[4], tmp[4] = x4, x4
	out[5], tmp[5] = x5, x5
	out[6], tmp[6] = x6, x6
	out[7], tmp[7] = x7
	out[8], tmp[8] = x8, x8
	out[9], tmp[9] = x9, x9
	out[10], tmp[10] = x10, x10
	out[11], tmp[11] = x11, x11
	out[12], tmp[12] = x12, x12
	out[13], tmp[13] = x13, x13
	out[14], tmp[14] = x14, x14
	out[15], tmp[15] = x15, x15
}

func xorBlocks(a, b []uint32) {
	for i := range a {
		a[i] ^= b[i]
	}
}
