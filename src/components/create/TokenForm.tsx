import { useState, useRef } from 'react';
import StepHeader from './StepHeader';

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
    <div>
      <StepHeader step={2} title="Token details" subtitle="These can't be changed after launch." />

      {/* Name + Ticker */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
            Token name
          </label>
          <input
            type="text"
            className="w-full bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
            placeholder="e.g. HYPERBULL"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={32}
          />
        </div>
        <div>
          <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
            Ticker
          </label>
          <input
            type="text"
            className="w-full bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
            placeholder="e.g. HBULL"
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            maxLength={8}
          />
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
          Description <span className="text-txt-4 normal-case tracking-normal text-[11px]">(optional)</span>
        </label>
        <textarea
          className="w-full h-20 bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 resize-none transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
          placeholder="What's the vibe?"
          maxLength={280}
        />
      </div>

      {/* Image upload */}
      <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
        Token image
      </label>
      <div
        className="border border-dashed border-border-2 rounded-xl flex flex-col items-center justify-center h-[100px] cursor-pointer transition-all duration-200 bg-bg-2/40 hover:border-mint/40 hover:bg-mint/[0.04]"
        onClick={() => fileRef.current?.click()}
      >
        <div className="text-xl mb-1.5 opacity-50">🖼</div>
        <div className="text-[13px] text-txt-3">Click or drag to upload</div>
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
        className="flex items-center gap-2 text-[13px] text-txt-2 cursor-pointer px-3.5 py-2.5 mt-3 border border-border rounded-lg bg-bg-2/40 transition-all duration-150 hover:border-border-2 hover:text-txt"
        onClick={() => setSocialOpen(!socialOpen)}
      >
        <span>🔗</span>
        <span className="text-txt-2">Add social links</span>
        <span className="text-txt-4 text-[11px]">(optional)</span>
        <span
          className={`ml-auto text-sm text-txt-3 transition-transform duration-200 ${socialOpen ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </div>
      {socialOpen && (
        <div className="border-l-2 border-mint/20 pl-4 ml-3 mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
                Twitter / X
              </label>
              <input
                type="text"
                className="w-full bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
                placeholder="@handle"
              />
            </div>
            <div>
              <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
                Telegram
              </label>
              <input
                type="text"
                className="w-full bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
                placeholder="t.me/..."
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-1.5 block font-medium">
              Website <span className="text-txt-4 normal-case tracking-normal text-[11px]">(optional)</span>
            </label>
            <input
              type="text"
              className="w-full bg-bg-2/60 border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-txt font-mono outline-0 transition-all duration-150 focus:border-border-2 focus:bg-bg-2 placeholder:text-txt-4"
              placeholder="https://..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
