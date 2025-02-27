import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'

export interface FalconArgs {
  tag: string
  cid: string
}

export class Falcon extends pulumi.ComponentResource {
  private readonly cid: string
  private readonly repo: pulumi.Output<string>
  private readonly ecr: pulumi.Output<aws.ecr.GetRepositoryResult>

  public getCid (): string {
    return this.cid
  }

  public getImageRepository (): pulumi.Output<string> {
    return this.repo
  }

  /*
   * Perform the same steps as the Crowdstrike ECS Task Definition Patching Utility, add
   * the entrypoint, PTRACE permission and shared binary volume to the existing containers
   * and then add the falcon container sidecar.
   */
  public injectFalcon (definition: string): pulumi.Output<string> {
    const containers: any[] = JSON.parse(definition)

    containers.forEach((container, idx) => {
      const linuxParameters = container.linuxParameters || {}
      container.linuxParameters = {
        ...linuxParameters,
        ...{
          capabilities: {
            add: [
              'SYS_PTRACE'
            ],
            drop: []
          }
        }
      }

      if (container.entryPoint === undefined || container.entryPoint.length === 0) {
        throw new Error(`Container ${container.name} must have entryPoint`)
      }
      if (container.command === undefined || container.command.length === 0) {
        throw new Error(`Container ${container.name} must have command`)
      }
      // Launch the container with the Falcon entrypoint
      container.entryPoint.unshift(
        '/tmp/CrowdStrike/rootfs/lib64/ld-linux-x86-64.so.2',
        '--library-path',
        '/tmp/CrowdStrike/rootfs/lib64',
        '/tmp/CrowdStrike/rootfs/bin/bash',
        '/tmp/CrowdStrike/rootfs/entrypoint-ecs.sh')
      container.entryPoint.push(...container.command)
      delete container.command

      container.dependsOn ||= []
      container.dependsOn.push({
        condition: 'COMPLETE',
        containerName: 'crowdstrike-falcon-init-container'
      })

      container.environment ||= []
      container.environment.push({
        name: 'FALCONCTL_OPTS',
        value: `--cid=${this.getCid()}`
      })

      container.mountPoints ||= []
      container.mountPoints.push({
        containerPath: '/tmp/CrowdStrike',
        readOnly: true,
        sourceVolume: 'crowdstrike-falcon-volume'
      })
    })

    containers.push({
      name: 'crowdstrike-falcon-init-container',
      image: this.getImageRepository(),
      entryPoint: [
        '/bin/bash',
        '-c',
        'chmod u+rwx /tmp/CrowdStrike && mkdir /tmp/CrowdStrike/rootfs && cp -r /bin /etc /lib64 /usr /entrypoint-ecs.sh /tmp/CrowdStrike/rootfs && chmod -R a=rX /tmp/CrowdStrike'
      ],
      essential: false,
      mountPoints: [
        {
          containerPath: '/tmp/CrowdStrike',
          readOnly: false,
          sourceVolume: 'crowdstrike-falcon-volume'
        }
      ],
      readonlyRootFilesystem: true,
      user: '0:0'
    })

    return pulumi.jsonStringify(containers)
  }

  constructor (name: string, args: FalconArgs, opts?: pulumi.ComponentResourceOptions) {
    super('falcon', name, {}, opts)

    this.cid = args.cid

    this.ecr = aws.ecr.getRepositoryOutput({ name: 'crowdstrike/falcon-sensor' })
    const falcontag = aws.ecr.getImageOutput({
      imageTag: args.tag,
      repositoryName: this.ecr.name
    })
    this.repo = pulumi.concat(this.ecr.repositoryUrl, ':', falcontag.imageTag)

    pulumi.runtime.registerStackTransformation((args: any) => {
      if (args.type === 'aws:ecs/taskDefinition:TaskDefinition') {
        // Patch container definitions
        const containers = pulumi.output(args.props.containerDefinitions as string)
        args.props.containerDefinitions = containers.apply(t => (this.injectFalcon(t)))
        // Add shared volume
        const volumes = pulumi.output(args.props.volumes ?? [])
        args.props.volumes = volumes.apply(t => (t.concat({ name: 'crowdstrike-falcon-volume' })))

        return { props: args.props, opts: args.opts }
      }
      return undefined
    })
  }
}
