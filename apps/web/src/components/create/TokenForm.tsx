import { useState, useRef } from "react";

import StepHeader from "./StepHeader";
import styles from "./TokenForm.module.css";
import { cn } from "../../utils/format";
import Button from "../shared/Button";

interface Props {
  name: string;
  ticker: string;
  description: string;
  socialLinks: { twitter: string; telegram: string; website: string };
  imagePreview: string | null;
  onNameChange: (v: string) => void;
  onTickerChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onSocialLinksChange: (links: { twitter: string; telegram: string; website: string }) => void;
  onImageChange: (file: File | null, preview: string | null) => void;
}

export default function TokenForm({
  name,
  ticker,
  description,
  socialLinks,
  imagePreview,
  onNameChange,
  onTickerChange,
  onDescriptionChange,
  onSocialLinksChange,
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
      <StepHeader
        step={2}
        title="Token details"
        subtitle="These can't be changed after launch."
      />

      <div className={styles.fieldGrid}>
        <div>
          <label className={styles.label}>Token name</label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. HYPERBULL"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={32}
          />
        </div>
        <div>
          <label className={styles.label}>Ticker</label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. HBULL"
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            maxLength={8}
          />
        </div>
      </div>

      <div className={styles.fieldBlock}>
        <label className={styles.label}>
          Description <span className={styles.optionalTag}>(optional)</span>
        </label>
        <textarea
          className={styles.textarea}
          placeholder="What's the vibe?"
          maxLength={280}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>

      <label className={styles.label}>Token image</label>
      {imagePreview ? (
        <div className={styles.previewZone}>
          <img
            src={imagePreview}
            alt="Token preview"
            className={styles.previewImage}
          />
          <div className={styles.previewActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Change
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onImageChange(null, null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={styles.uploadZone}
          onClick={() => fileRef.current?.click()}
        >
          <div className={styles.uploadIcon}>🖼</div>
          <div className={styles.uploadText}>Click or drag to upload</div>
          <div className={styles.uploadHint}>PNG, JPG, GIF · max 5MB</div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className={styles.fileInput}
        onChange={handleFile}
      />

      <div
        className={styles.socialToggle}
        onClick={() => setSocialOpen(!socialOpen)}
      >
        <span>🔗</span>
        <span className={styles.socialLinkLabel}>Add social links</span>
        <span className={styles.socialOptional}>(optional)</span>
        <span className={cn(styles.chevron, socialOpen && styles.chevronOpen)}>
          ›
        </span>
      </div>
      {socialOpen && (
        <div className={styles.socialPanel}>
          <div className={styles.socialFieldGrid}>
            <div>
              <label className={styles.label}>Twitter / X</label>
              <input
                type="text"
                className={styles.input}
                placeholder="@handle"
                value={socialLinks.twitter}
                onChange={(e) => onSocialLinksChange({ ...socialLinks, twitter: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label}>Telegram</label>
              <input
                type="text"
                className={styles.input}
                placeholder="t.me/..."
                value={socialLinks.telegram}
                onChange={(e) => onSocialLinksChange({ ...socialLinks, telegram: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={styles.label}>
              Website <span className={styles.optionalTag}>(optional)</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="https://..."
              value={socialLinks.website}
              onChange={(e) => onSocialLinksChange({ ...socialLinks, website: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
