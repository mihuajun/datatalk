import Link from "next/link";

import { AuthBrand } from "@/components/auth/auth-brand";

export function LegalPage({ type }: { type: "terms" | "privacy" }) {
  const isTerms = type === "terms";
  return <main className="min-h-screen bg-[#F7F9FC] px-5 py-8 text-[#17243A] sm:px-8 sm:py-12"><div className="mx-auto max-w-[920px]"><div className="flex items-center justify-between gap-5"><AuthBrand /><Link href="/" className="text-sm font-semibold text-[#2167E8] hover:underline">返回登录</Link></div><article className="mt-10 rounded-lg border border-[#DDE5F0] bg-white px-6 py-8 shadow-[0_12px_32px_rgba(38,91,158,0.06)] sm:px-12 sm:py-12"><header className="border-b border-[#E7EDF5] pb-7"><p className="text-xs font-semibold tracking-[0.08em] text-[#2167E8]">DATATALK</p><h1 className="mt-3 text-[30px] font-bold tracking-[-0.03em]">{isTerms ? "服务条款" : "隐私政策"}</h1><p className="mt-3 text-sm text-[#71819B]">生效日期：2026 年 10 月 1 日</p></header>{isTerms ? <TermsContent /> : <PrivacyContent />}</article></div></main>;
}

function TermsContent() {
  return <div className="legal-content"><p>欢迎使用 DataTalk。DataTalk 是一个通过自然语言辅助完成数据连接、分析和报表开发的工作台。使用或访问 DataTalk，即表示你已阅读、理解并同意本服务条款。</p><h2>一、账号注册与使用</h2><p>你应提供真实、准确且完整的注册信息，并妥善保管账号、密码及验证码。账号下发生的操作，通常视为由你本人进行。发现未经授权的使用时，请及时联系管理员。</p><p>你可以使用手机号或邮箱注册账号。手机号注册需要通过短信验证码验证，邮箱注册需要通过邮件验证码验证。注册完成后，可以使用对应的手机号或邮箱与密码登录。</p><h2>二、服务使用规范</h2><p>你不得利用 DataTalk 从事违反法律法规、侵犯他人合法权益、干扰系统安全或影响其他用户正常使用的活动。你不得上传或处理未经授权的个人信息、商业秘密、受版权保护的内容或恶意程序。</p><h2>三、数据与内容</h2><p>你对通过 DataTalk 提交、连接、生成或保存的业务数据及内容承担相应责任。你应确认自己拥有处理这些数据所需的权利和授权。</p><p>DataTalk 生成的分析结果是辅助信息，不构成法律、财务、医疗或投资建议。你应根据实际业务情况核验数据和结论后再使用。</p><h2>四、第三方服务</h2><p>短信、邮件、数据源连接和其他外部服务可能由第三方提供。第三方服务的可用性、费用和服务条款由相应服务商负责，DataTalk 会在合理范围内展示相关错误或配置状态。</p><h2>五、服务变更与终止</h2><p>我们可能根据产品迭代、维护或安全需要调整、暂停部分功能。对于严重违反本条款、危害系统安全或法律法规要求的账号，我们可以采取限制访问、暂停或终止服务等措施。</p><h2>六、条款更新</h2><p>我们可能更新本条款。更新后会在本页面展示新的生效日期。继续使用 DataTalk 表示你接受更新后的条款。</p><h2>七、联系我们</h2><p>如果你对服务条款有疑问，请通过 DataTalk 管理员或产品支持渠道联系我们。</p></div>;
}

function PrivacyContent() {
  return <div className="legal-content"><p>DataTalk 重视你的隐私。本隐私政策说明我们在你使用账号注册、登录和数据分析功能时，如何收集、使用、保存和保护相关信息。</p><h2>一、我们收集的信息</h2><p>注册和登录时，我们可能收集用户名、手机号、邮箱地址、密码摘要、登录时间和账号状态。密码会以加盐摘要形式保存，我们不会以明文保存你的密码。</p><p>使用短信或邮箱验证码时，我们会保存验证码摘要、有效期、发送频率和验证次数等安全信息，用于完成身份验证、防止滥用和保障服务安全。</p><p>使用报表、数据源和工作台功能时，我们会处理你主动提交的报表定义、数据源连接信息、操作记录和生成结果。</p><h2>二、信息的使用</h2><p>我们使用这些信息来创建和维护你的工作台、完成登录验证、发送验证码、提供报表和数据分析功能、处理故障、改进服务并保护账号安全。</p><h2>三、数据源与敏感信息</h2><p>如果你配置外部数据源，连接信息仅用于建立你主动发起的数据访问。数据源密码等敏感字段应由你按照最小权限原则配置。请不要在报表内容、对话或数据源中提交与服务无关的敏感个人信息。</p><h2>四、信息共享</h2><p>为完成你主动使用的功能，我们可能向对应的服务提供商传输必要信息，例如向短信服务商发送手机号和验证码参数，向邮件服务商发送收件地址和验证码邮件。我们不会出售你的个人信息。</p><h2>五、信息保存与安全</h2><p>我们会根据提供服务和满足安全审计所需的期限保存信息，并采取访问控制、密码摘要、验证码时效和传输加密等措施保护信息。任何互联网服务都不能保证绝对安全，请妥善保管账号信息。</p><h2>六、你的权利</h2><p>在适用法律允许的范围内，你可以通过管理员申请查看、更正或删除账号资料，也可以申请停用账号。删除账号可能影响工作台、报表和历史操作记录的使用。</p><h2>七、政策更新与联系我们</h2><p>我们可能根据业务或法律要求更新本政策，并在本页面更新生效日期。如果你对隐私处理有疑问，请通过 DataTalk 管理员或产品支持渠道联系我们。</p></div>;
}
