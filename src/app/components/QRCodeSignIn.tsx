"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";

interface QRCodeSignInProps {
  url?: string;
}

export default function QRCodeSignIn({ url: initialUrl }: QRCodeSignInProps) {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState(initialUrl || "");

  useEffect(() => {
    setMounted(true);
    // Use the browser's origin (e.g., https://example.com) for the QR code
    if (typeof window !== "undefined") {
      setUrl(window.location.origin);
    }
  }, []);

  if (!mounted) return null;

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <a 
        href={url}
        className="relative group cursor-pointer block"
        title="Click to open Azure Deployment"
      >
        <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 to-teal-500/10 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="relative p-3 bg-white rounded-2xl border border-slate-100 shadow-sm transition-all duration-300 group-hover:shadow-md group-hover:border-slate-200">
          <QRCodeSVG
            value={url}
            size={120}
            level="H"
            includeMargin={false}
            fgColor="#0f172a"
            imageSettings={{
              src: "/bmo-icon-logo.png",
              x: undefined,
              y: undefined,
              height: 32,
              width: 32,
              excavate: true,
            }}
          />
        </div>
      </a>
      
      <div className="flex flex-col items-center gap-1">
        <p className="text-[0.7rem] font-medium text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
          <Globe className="w-3 h-3" />
          Scan or click to open on your browser
        </p>
      </div>
    </div>
  );
}