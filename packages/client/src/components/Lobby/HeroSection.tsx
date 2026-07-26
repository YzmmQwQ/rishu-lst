import { motion } from 'motion/react'

export function HeroSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-10 text-center"
    >
      <div className="section-label justify-center">LET'S LISTEN TOGETHER</div>
      <h1 className="hero-title">Let&apos;s listen together.</h1>
      <p className="hero-desc">创建或加入一个房间，实时同步音乐播放</p>
    </motion.div>
  )
}
