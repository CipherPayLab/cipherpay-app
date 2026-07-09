import React from 'react';
import { X } from 'lucide-react';

const TONE_STYLES = {
  info: {
    bar: 'from-blue-500 to-purple-600',
    iconBox: 'border-white/10 bg-white/5',
    iconColor: 'text-blue-400',
    primaryButton: 'bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90',
  },
  error: {
    bar: 'from-red-500 to-orange-500',
    iconBox: 'border-red-500/30 bg-red-500/10',
    iconColor: 'text-red-400',
    primaryButton: 'bg-red-500/90 hover:bg-red-500',
  },
  success: {
    bar: 'from-green-500 to-blue-500',
    iconBox: 'border-green-500/30 bg-green-500/10',
    iconColor: 'text-green-400',
    primaryButton: 'bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90',
  },
};

function MessageModal({
  open,
  onClose,
  tone = 'info',
  icon: Icon,
  title,
  description,
  primaryLabel = 'OK',
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  if (!open) return null;

  const styles = TONE_STYLES[tone] || TONE_STYLES.info;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-[92%] max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0d1220]/95 shadow-2xl backdrop-blur">
        <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${styles.bar}`} />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-8">
          <div className="mb-5 flex items-start gap-4">
            {Icon && (
              <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${styles.iconBox}`}>
                <Icon className={`h-5 w-5 ${styles.iconColor}`} />
              </div>
            )}
            <h2 className="pt-2 text-lg font-semibold text-white">{title}</h2>
          </div>

          {description && (
            <p className="mb-6 whitespace-pre-wrap text-sm leading-6 text-gray-300">{description}</p>
          )}

          <div className="flex gap-3">
            {secondaryLabel && (
              <button
                type="button"
                onClick={onSecondary || onClose}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                {secondaryLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onPrimary || onClose}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity ${styles.primaryButton}`}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MessageModal;
