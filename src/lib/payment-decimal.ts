function addDigits(left: string, right: string): string {
  let carry = 0;
  let output = "";
  let a = left.length - 1;
  let b = right.length - 1;
  while (a >= 0 || b >= 0 || carry) {
    const sum = (a >= 0 ? Number(left[a--]) : 0) + (b >= 0 ? Number(right[b--]) : 0) + carry;
    output = String(sum % 10) + output;
    carry = Math.floor(sum / 10);
  }
  return output;
}

function multiplyDigits(left: string, right: string): string {
  const digits = Array.from({ length: left.length + right.length }, () => 0);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) digits[i + j + 1] += Number(left[i]) * Number(right[j]);
  }
  for (let index = digits.length - 1; index > 0; index--) {
    digits[index - 1] += Math.floor(digits[index] / 10);
    digits[index] %= 10;
  }
  return digits.join("").replace(/^0+(?=\d)/, "");
}

function roundedProduct(digits: string, sourcePlaces: number, targetPlaces: number): string {
  const padded = digits.padStart(sourcePlaces + 1, "0");
  if (sourcePlaces <= targetPlaces) return padded + "0".repeat(targetPlaces - sourcePlaces);
  const cut = padded.length - sourcePlaces + targetPlaces;
  const retained = padded.slice(0, cut) || "0";
  return Number(padded[cut] ?? "0") >= 5 ? addDigits(retained, "1") : retained;
}

export function multiplyToFixed(amount: string, rate: string, decimals = 2): string {
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !/^\d+(?:\.\d+)?$/.test(rate)) return "—";
  const [amountWhole, amountFraction = ""] = amount.split(".");
  const [rateWhole, rateFraction = ""] = rate.split(".");
  const product = multiplyDigits(
    `${amountWhole}${amountFraction}`.replace(/^0+(?=\d)/, ""),
    `${rateWhole}${rateFraction}`.replace(/^0+(?=\d)/, ""),
  );
  const digits = roundedProduct(product, amountFraction.length + rateFraction.length, decimals);
  const padded = digits.padStart(decimals + 1, "0");
  return decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded;
}

export function addDecimalValues(left: string, right: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(left) || !/^\d+(?:\.\d+)?$/.test(right)) return "0";
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const places = Math.max(leftFraction.length, rightFraction.length);
  const zeros = "0".repeat(places);
  const leftDigits = `${leftWhole}${(leftFraction + zeros).slice(0, places)}`.replace(/^0+(?=\d)/, "");
  const rightDigits = `${rightWhole}${(rightFraction + zeros).slice(0, places)}`.replace(/^0+(?=\d)/, "");
  const sum = addDigits(leftDigits, rightDigits).padStart(places + 1, "0");
  return places ? `${sum.slice(0, -places)}.${sum.slice(-places)}` : sum;
}

export function formatDecimal(value: string, decimals = 2): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return "0." + "0".repeat(decimals);
  const [whole, fraction = ""] = value.split(".");
  const digits = roundedProduct(`${whole}${fraction}`.replace(/^0+(?=\d)/, ""), fraction.length, decimals);
  const padded = digits.padStart(decimals + 1, "0");
  return decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded;
}
