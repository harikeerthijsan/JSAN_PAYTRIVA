import Image from "next/image";
import jsanLogo from "./jsan-logo.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  const height = compact ? 28 : 36;
  const width = Math.round((height * jsanLogo.width) / jsanLogo.height);
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
      <Image className="brand-logo" src={jsanLogo} alt="JSAN Consulting" height={height} width={width} priority />
      <span className="brand-copy">
        <strong>PAYTRIVA</strong>
        <small>FINANCIAL CONTROL</small>
      </span>
    </div>
  );
}
