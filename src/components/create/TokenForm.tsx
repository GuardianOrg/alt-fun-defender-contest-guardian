import { useState, useRef } from 'react';

interface Props {
  name: string;
  ticker: string;
  onNameChange: (v: string) => void;
  onTickerChange: (v: string) => void;
  onImageChange: (file: File | null, preview: string | null) => void;
}

export default function TokenForm({
  name,
  ticker,
  onNameChange,
  onTickerChange,
  onImageChange,
}: Props) {
  const [socialOpen, setSocialOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onImageChange(file, ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mb-7">
      <div className="text-[11px] tracking-[0.14em] uppercase text-mint mb-1">step 2</div>
      <div className="font-display text-xl font-semibold text-txt tracking-[0.03em] mb-1">
        Token details
      </div>
      <div className="text-[13px] text-txt-3 mb-4">These can&apos;t be changed after launch.</div>

      {/* Name + Ticker */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
            Token name
          </label>
          <input
            type="text"
            className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 transition-colors focus:border-border-2 placeholder:text-txt-4"
            placeholder="e.g. HYPERBULL"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={32}
          />
        </div>
        <div>
          <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
            Ticker
          </label>
          <input
            type="text"
            className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 transition-colors focus:border-border-2 placeholder:text-txt-4"
            placeholder="e.g. HBULL"
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            maxLength={8}
          />
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
          Description <span className="text-txt-4 normal-case tracking-normal text-[11px]">(optional)</span>
        </label>
        <textarea
          className="w-full h-20 bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 resize-none transition-colors focus:border-border-2 placeholder:text-txt-4"
          placeholder="What's the vibe?"
          maxLength={280}
        />
      </div>

      {/* Image upload */}
      <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
        Token image
      </label>
      <div
        className="border border-dashed border-border-2 rounded-[3px] flex flex-col items-center justify-center h-[100px] cursor-pointer transition-all bg-bg-2 hover:border-mint hover:bg-mint-bg"
        onClick={() => fileRef.current?.click()}
      >
        <div className="text-xl mb-1.5 opacity-50">🖼</div>
        <div className="text-[12px] text-txt-3">Click or drag to upload</div>
        <div className="text-[11px] text-txt-4 mt-[2px]">PNG, JPG, GIF · max 5MB</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {/* Social links */}
      <div
        className="flex items-center gap-2 text-[13px] text-txt-2 cursor-pointer px-3 py-2.5 mt-2 border border-border rounded-[3px] bg-bg-2 transition-all hover:border-border-2 hover:text-txt"
        onClick={() => setSocialOpen(!socialOpen)}
      >
        <span>🔗</span>
        <span className="text-txt-2">Add social links</span>
        <span className="text-txt-4 text-[12px]">(optional)</span>
        <span
          className={`ml-auto text-sm text-txt-3 transition-transform ${socialOpen ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </div>
      {socialOpen && (
        <div className="border-l border-border pl-3.5 ml-1 mt-2.5">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
                Twitter / X
              </label>
              <input
                type="text"
                className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 transition-colors focus:border-border-2 placeholder:text-txt-4"
                placeholder="@handle"
              />
            </div>
            <div>
              <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
                Telegram
              </label>
              <input
                type="text"
                className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 transition-colors focus:border-border-2 placeholder:text-txt-4"
                placeholder="t.me/..."
              />
            </div>
          </div>
          <div>
            <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
              Website <span className="text-txt-4 normal-case tracking-normal text-[11px]">(optional)</span>
            </label>
            <input
              type="text"
              className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-[9px] text-[13px] text-txt font-mono outline-0 transition-colors focus:border-border-2 placeholder:text-txt-4"
              placeholder="https://..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
