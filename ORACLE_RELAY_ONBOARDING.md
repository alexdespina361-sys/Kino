# Oracle setup for Kino's video relay

Prepared on 16 October 2026. You create the Oracle account and one VM; I can then connect from this PC to test and deploy the relay. Your friend continues opening the Kino website, with no TV installation.

The first deployment checkpoint is whether the new VM can fetch the provider's video. No Oracle account or VM has been created by this chat, and nothing has been switched on the live website.

1. **Create the standard Oracle Cloud Free Tier account.**

   Open [Oracle's signup page](https://signup.cloud.oracle.com/). Complete email verification, identity/contact details, password, and card verification yourself. Keep the standard Free Tier account. The $300 credit is a temporary trial; the selected VM must fit Always Free allowances afterward. Do not upgrade to Pay As You Go for this setup. [Oracle's explanation](https://www.oracle.com/cloud/free/faq/).

2. **Choose a home region.**

   An available European region is sensible for your location; Germany Central (Frankfurt) is one example if offered. This is a location choice, not a claim that free VM capacity is currently available there. The home region cannot be changed afterward, and Always Free compute must be provisioned there. [Home-region rules](https://docs.oracle.com/en-us/iaas/Content/Identity/regions/managingregions.htm).

3. **Create a network with internet access.**

   In the Oracle Console, go to **Networking → Virtual cloud networks → Start VCN Wizard → Create VCN with Internet Connectivity**. Name it `kino-relay-vcn`, keep the suggested non-overlapping IPv4 ranges, and finish the wizard. It creates public/private subnets and the gateway/routes. We will use its **public subnet**. [Oracle's guided network setup](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm).

4. **Create the virtual machine.**

   Go to **Compute → Instances → Create instance**. Use:

   | Setting | Selection |
   | --- | --- |
   | Name | `kino-stream-relay` |
   | Image | Canonical Ubuntu 24.04 LTS platform image, compatible with the shape |
   | Shape | `VM.Standard.A1.Flex` (Arm) |
   | OCPUs | `1` |
   | Memory | `2 GB` |
   | Boot volume | `50 GB`, default performance; no extra volumes |
   | Network | The new `kino-relay-vcn` |
   | Subnet | Its public subnet |
   | Public IPv4 | Automatically assign: enabled |

   These settings are inside Oracle's currently published A1 and storage free allowances. Avoid paid Marketplace images and adding extra resources from the trial credit. [Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

   If A1 reports **out of host capacity**, try another availability domain in the same home region. An available Always Free `VM.Standard.E2.1.Micro` with an Ubuntu image is a smaller fallback for initial testing; its throughput still needs testing. There is no need to create a second VM if the first one succeeds. Do not substitute an arbitrary paid shape.

5. **Upload the prepared SSH public key before creating the instance.**

   In **Add SSH keys**, select **Upload public key files (.pub)** and choose:

   `C:\Users\Me\Desktop\WebPlayer\output\oracle-relay\kino-relay-ssh.pub`

   Upload this exact `.pub` file rather than choosing Oracle's key-generation option. The matching private key already lives on this PC at `C:\Users\Me\.ssh\kino-oracle-relay\id_rsa`. It is not in the deployment folder and does not need to be pasted into chat or uploaded to Oracle. [Oracle's public-key upload instructions](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm).

   Create the instance, wait until its state is **Running**, and copy its **Public access IP address/Public IPv4 address**. For this Ubuntu image, the SSH username is `ubuntu`. [Connection details](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/connect-to-linux-instance.htm).

6. **Allow SSH and web traffic in the public subnet's security list.**

   Open the instance's subnet, then its security list. You can also navigate through **Networking → Virtual cloud networks → kino-relay-vcn → Security Lists** and select the list attached to the public subnet. Add/edit **Ingress Rules** so these TCP rules exist:

   | Source CIDR | Destination port | Purpose |
   | --- | --- | --- |
   | `YOUR_PC_PUBLIC_IPV4/32` | `22` | SSH from this PC's current public IPv4 |
   | `0.0.0.0/0` | `80` | HTTPS certificate setup and HTTP redirect |
   | `0.0.0.0/0` | `443` | Video delivery over HTTPS |

   Use source type **CIDR**, protocol **TCP**, source port **All**, and leave **Stateless unchecked**. If the default SSH rule already allows `0.0.0.0/0` on port 22, edit its source to the `/32` above rather than adding an ineffective narrower duplicate. Leave the default ICMP and outbound rules in place. Port `8789` stays internal; it does not need a public ingress rule. [Security-list workflow](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/scenarioa.htm), [rule semantics](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm).

   The current SSH source CIDR is saved locally in `output/oracle-relay/SSH-SOURCE.txt`; use its value in place of `YOUR_PC_PUBLIC_IPV4/32`. It was checked from this PC on 16 October and can change with the connection/VPN. If SSH cannot connect later, I will recheck it before asking you to adjust that one rule. The VM's operating-system firewall is separate; I will configure it after SSH access works.

7. **Send the handoff information in this chat.**

   Copy this template and fill in what you have:

   ```text
   Oracle VM public IPv4:
   Home region:
   Shape / OCPUs / RAM:
   Image / Ubuntu version:
   Instance status: Running
   Uploaded key: kino-relay-ssh.pub
   Ports 22, 80 and 443 configured: yes/no
   DNS provider or ability to add another hostname:
   Render service name or dashboard link:
   ```

   The first connection only needs the VM's public IPv4, the expected Ubuntu image and the public key uploaded. Region/shape details let me verify the intended setup. I do not need your Oracle login, card details, MFA codes, API signing keys or private SSH key in chat. The Render service name/link is not a password; it identifies which website service receives the later environment settings.

8. **I test and deploy; then we add the relay hostname and switch Kino.**

   The deployment archive is already prepared at `output/oracle-relay/kino-relay-deploy.tar.gz`. It contains the relay's source/dependency files and upstream preflight, without local private keys, environment files, browser profiles or video files. No GitHub account/token is needed just to upload it to the VM.

   I will upload the preflight and run it **on the VM**, checking fresh host-issued tokens, playlists and recognizable media samples. This tests the VM's own public connection. If its IP is rejected by the provider, we troubleshoot that result before changing the website.

   After a successful preflight, we add a new **A** DNS record pointing a relay hostname to the VM's public IPv4. A name such as `kino-relay.24-7.ro` is only an example; availability and control of that name must be confirmed. The existing domain's nameservers are Afraid.org, but ownership/access to the DNS account has not been verified. If Cloudflare manages the chosen name, use **DNS only**, without its traffic proxy.

   I then deploy an automatically restarting relay and an HTTPS reverse proxy, generate a shared signing secret, and verify a real extension-free browser session. The website's settings become:

   ```text
   EDGE_STREAM_PROXY_URL=https://YOUR-RELAY-HOSTNAME/api/proxy
   EDGE_STREAM_PROXY_KEY=<same secret as the relay's STREAM_RELAY_KEY>
   PROXY_VIDEO=off
   ```

   Secrets stay in protected host configuration. If Render management access is unavailable here, I will give you the exact settings through a local file for entry in Render's Environment page. The secret does not need to be pasted into chat.

   Completion means real video frames and Kino controls work without the extension, media requests use the relay, and Render's video-proxy byte counter remains unchanged. Your friend's actual TV browser still needs a final device check when available. The free tier has capacity/reclamation limitations; this setup does not turn it into an uptime guarantee.

The software deployment guide is [STREAM_RELAY_SETUP.md](STREAM_RELAY_SETUP.md). Account creation/card verification, an actual free VM and control of a relay hostname remain required; none has been created by this preparation.
