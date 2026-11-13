export const money = (value) => Number(Number(value).toFixed(2));
export const slugify = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const digits = (value = "") => String(value).replace(/\D/g, "");
export function validCpf(value) {
  const cpf = digits(value);
  if (!cpf) return true;
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let size = 9; size <= 10; size++) {
    const sum = [...cpf.slice(0, size)].reduce(
      (n, digit, i) => n + Number(digit) * (size + 1 - i),
      0,
    );
    if (((sum * 10) % 11) % 10 !== Number(cpf[size])) return false;
  }
  return true;
}
