import Nav from '@/components/Nav'
import JudgeView from '@/components/JudgeView'

export const metadata = {
  title: 'Bow — Judge Quick Start',
  description: 'One page with every verifiable claim about Bow on Arc, for hackathon judging.',
}

export default function JudgePage() {
  return (
    <div className="min-h-screen relative">
      <Nav />
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-20">
        <JudgeView />
      </main>
    </div>
  )
}
