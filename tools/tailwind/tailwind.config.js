// 由 index.html 原本的 CDN 設定搬出；修改後在 tools/tailwind 執行 npm run build
module.exports = {
  content: ['../../index.html', '../../js/pro/**/*.js'],
  // score.js 以 text-${color}-400 動態組字，需列入白名單
  safelist: ['text-emerald-400', 'text-rose-400'],
  theme:  {
        extend: {
          fontFamily: {
            mono: ['"Courier New"', 'Courier', 'monospace'],
          },
          animation: {
            'pop-in': 'popIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            'glow': 'pulseGlow 2s infinite',
            'float': 'float 3s ease-in-out infinite',
            'shimmer': 'shimmer 2.5s linear infinite',
            'spin-slow': 'spin 8s linear infinite',
            'gradient-xy': 'gradientXY 10s ease infinite',
            'bounce-soft': 'bounceSoft 2s infinite',
            'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
          },
          keyframes: {
            popIn: {
              '0%': { transform: 'scale(0.8) translateY(20px)', opacity: '0' },
              '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
            },
            pulseGlow: {
              '0%, 100%': { boxShadow: '0 0 20px 0px rgba(99, 102, 241, 0.4)' },
              '50%': { boxShadow: '0 0 40px 15px rgba(99, 102, 241, 0.7)' },
            },
            float: {
              '0%, 100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(-10px)' },
            },
            shimmer: {
              '0%': { transform: 'translateX(-150%) skewX(-15deg)' },
              '100%': { transform: 'translateX(250%) skewX(-15deg)' },
            },
            gradientXY: {
              '0%, 100%': { backgroundSize: '400% 400%', backgroundPosition: '0% 50%' },
              '50%': { backgroundSize: '400% 400%', backgroundPosition: '100% 50%' },
            },
            bounceSoft: {
              '0%, 100%': { transform: 'translateY(-5%)', animationTimingFunction: 'cubic-bezier(0.8,0,1,1)' },
              '50%': { transform: 'translateY(0)', animationTimingFunction: 'cubic-bezier(0,0,0.2,1)' },
            }
          }
        }
      }
};
